"""NimBus AI chat service — powered by Ollama with tool use.

Uses Ollama's OpenAI-compatible API endpoint for streaming responses
with function calling / tool use support for search_documents and request_access.
"""

import json
import logging
from typing import AsyncIterator

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

# System prompt for NimBus AI
NIMBUS_SYSTEM_PROMPT = """Kamu adalah Nimbus, asisten Document Control untuk REIN (Remula Inti Rekayasa) — perusahaan engineering/rekayasa.

Peran Kamu:
- Membantu pengguna mencari dokumen di arsip
- Memproses unggahan dokumen baru ke Google Drive
- Mengelola persetujuan (approval) dokumen
- Memberikan akses sementara ke dokumen
- Menjawab pertanyaan tentang dokumen, proyek, dan klien

Aturan:
1. Selalu responsif dalam Bahasa Indonesia
2. Gunakan format yang rapi dan terstruktur
3. Saat mencari dokumen, gunakan tool search_documents
4. Saat pengguna meminta akses ke dokumen, gunakan tool request_access
5. Jika tidak yakin, katakan dengan jelas
6. Nomor dokumen mengikuti format: {TYPE}-{CLIENT}-{NUMBER} (contoh: DRW-PLB-0041)
7. Jenis dokumen: DRW (Gambar Teknik), INV (Invoice), PO (Purchase Order), SPK (Surat Perintah Kerja), RFP (Request for Proposal), RPT (Report), SPEC (Spesifikasi)

Format respons:
- Untuk pencarian: sertakan nomor dokumen, nama, klien, proyek
- Untuk akses: berikan informasi status permintaan
"""

# Tool definitions for function calling
NIMBUS_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_documents",
            "description": "Cari dokumen di arsip REIN berdasarkan kata kunci, tipe dokumen, klien, atau proyek.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Kata kunci pencarian (nomor dokumen, nama, klien, proyek)",
                    },
                    "doc_type": {
                        "type": "string",
                        "enum": ["DRW", "INV", "PO", "SPK", "RFP", "RPT", "SPEC", "OTHER"],
                        "description": "Filter berdasarkan tipe dokumen (opsional)",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Jumlah maksimal hasil (default 10)",
                        "default": 10,
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "request_access",
            "description": "Ajukan permintaan akses ke sebuah dokumen. Pengguna akan mendapat akses sementara setelah disetujui admin.",
            "parameters": {
                "type": "object",
                "properties": {
                    "document_id": {
                        "type": "string",
                        "description": "ID dokumen yang diminta aksesnya",
                    },
                    "reason": {
                        "type": "string",
                        "description": "Alasan permintaan akses",
                    },
                },
                "required": ["document_id", "reason"],
            },
        },
    },
]


def _get_auth_headers() -> dict[str, str]:
    """Build headers with optional Ollama API key."""
    headers = {"Content-Type": "application/json"}
    if settings.ollama_api_key:
        headers["Authorization"] = f"Bearer {settings.ollama_api_key}"
    return headers


async def stream_chat_response(
    messages: list[dict],
    conversation_id: str,
    model: str | None = None,
    user_id: str | None = None,
    db=None,
) -> AsyncIterator[str]:
    """Stream NimBus AI responses with tool use support.

    Yields SSE events with types: text, tool_call, search_results, confirmation.
    When the model calls a tool, the tool is executed and results are sent back
    to the model for a final response.
    """
    ollama_url = settings.ollama_base_url.rstrip("/")
    use_model = model or settings.ollama_model

    # Prepare messages in OpenAI format
    api_messages = [{"role": "system", "content": NIMBUS_SYSTEM_PROMPT}]
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if role in ("user", "assistant"):
            api_messages.append({"role": role, "content": content})

    # First call — may produce text or tool calls
    tool_result_messages = []
    async for event in _call_ollama(ollama_url, use_model, api_messages, NIMBUS_TOOLS):
        if event["type"] == "tool_calls":
            # Execute each tool call
            for tool_call in event["tool_calls"]:
                tool_name = tool_call["name"]
                tool_args = tool_call["arguments"]

                # Emit tool_call event
                yield f'data: {json.dumps({"type": "tool_call", "tool": tool_name, "args": tool_args}, ensure_ascii=False)}\n\n'

                # Execute the tool
                result = await _execute_tool(tool_name, tool_args, user_id=user_id, db=db)

                if tool_name == "search_documents":
                    yield f'data: {json.dumps({"type": "search_results", "results": result}, ensure_ascii=False)}\n\n'
                elif tool_name == "request_access":
                    yield f'data: {json.dumps({"type": "confirmation", "message": result.get("message", ""), "data": result}, ensure_ascii=False)}\n\n'

                # Accumulate tool result for follow-up call
                tool_result_messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.get("id", ""),
                    "content": json.dumps(result, ensure_ascii=False),
                })

            # Second call — with tool results injected
            followup_messages = api_messages + [
                {"role": "assistant", "content": None, "tool_calls": [
                    {"id": tc["id"], "type": "function", "function": {"name": tc["name"], "arguments": json.dumps(tc["arguments"])}}
                    for tc in event["tool_calls"]
                ]}
            ] + tool_result_messages

            async for followup_event in _call_ollama(ollama_url, use_model, followup_messages, NIMBUS_TOOLS):
                if followup_event["type"] == "text":
                    yield followup_event["data"]
        elif event["type"] == "text":
            yield event["data"]

    yield "data: [DONE]\n\n"


async def _call_ollama(
    ollama_url: str,
    model: str,
    messages: list[dict],
    tools: list[dict] | None = None,
) -> AsyncIterator[dict]:
    """Call Ollama's OpenAI-compatible API and yield parsed events.

    Yields dicts with type 'text' or 'tool_calls'.
    """
    request_body = {
        "model": model,
        "messages": messages,
        "stream": True,
        "temperature": 0.7,
        "max_tokens": 2048,
    }
    if tools:
        request_body["tools"] = tools

    headers = _get_auth_headers()

    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            req = client.build_request(
                "POST",
                f"{ollama_url}/v1/chat/completions",
                json=request_body,
                headers=headers,
            )
            response = await client.send(req, stream=True)
        except httpx.ConnectError:
            yield {
                "type": "text",
                "data": f'data: {json.dumps({"type": "text", "content": "⚠️ Server AI tidak tersedia. Ollama tidak terhubung."}, ensure_ascii=False)}\n\n',
            }
            return

        if response.status_code != 200:
            await response.aread()
            yield {
                "type": "text",
                "data": f'data: {json.dumps({"type": "text", "content": f"⚠️ Server AI error (status {response.status_code})."}, ensure_ascii=False)}\n\n',
            }
            return

        # Accumulate streaming response
        current_text = ""
        tool_calls_accum: dict[int, dict] = {}  # index -> {id, name, arguments_str}

        async for line in response.aiter_lines():
            if not line.strip() or not line.startswith("data: "):
                continue

            data_str = line[6:]
            if data_str.strip() == "[DONE]":
                break

            try:
                data = json.loads(data_str)
            except json.JSONDecodeError:
                continue

            choices = data.get("choices", [])
            if not choices:
                continue

            delta = choices[0].get("delta", {})

            # Text content
            content = delta.get("content", "")
            if content:
                current_text += content
                yield {
                    "type": "text",
                    "data": f'data: {json.dumps({"type": "text", "content": current_text}, ensure_ascii=False)}\n\n',
                }

            # Tool calls
            tool_calls_delta = delta.get("tool_calls", [])
            for tc in tool_calls_delta:
                idx = tc.get("index", 0)
                if idx not in tool_calls_accum:
                    tool_calls_accum[idx] = {
                        "id": tc.get("id", ""),
                        "name": tc.get("function", {}).get("name", ""),
                        "arguments_str": "",
                    }
                if tc.get("id"):
                    tool_calls_accum[idx]["id"] = tc["id"]
                if tc.get("function", {}).get("name"):
                    tool_calls_accum[idx]["name"] = tc["function"]["name"]
                if tc.get("function", {}).get("arguments"):
                    tool_calls_accum[idx]["arguments_str"] += tc["function"]["arguments"]

        # If tool calls were accumulated, emit a tool_calls event
        if tool_calls_accum:
            parsed_calls = []
            for idx in sorted(tool_calls_accum.keys()):
                tc_data = tool_calls_accum[idx]
                try:
                    args = json.loads(tc_data["arguments_str"])
                except json.JSONDecodeError:
                    args = {}
                parsed_calls.append({
                    "id": tc_data["id"],
                    "name": tc_data["name"],
                    "arguments": args,
                })
            yield {"type": "tool_calls", "tool_calls": parsed_calls}

        # If text was accumulated but no final event was sent, the streaming ended
        # The text was already yielded incrementally above


async def _execute_tool(
    tool_name: str, args: dict, user_id: str | None = None, db=None
) -> dict | list:
    """Execute a tool call and return the result."""
    if tool_name == "search_documents":
        return await _tool_search_documents(args, db=db)
    elif tool_name == "request_access":
        return await _tool_request_access(args, user_id=user_id, db=db)
    else:
        return {"error": f"Unknown tool: {tool_name}"}


async def _tool_search_documents(args: dict, db=None) -> list[dict]:
    """Search documents using the documents search endpoint logic."""
    query = args.get("query", "")
    doc_type = args.get("doc_type")
    limit = args.get("limit", 10)

    if not db:
        return [{"error": "Database not available"}]

    from sqlalchemy import select, or_
    from db.models.document import Document, DocType

    query_stmt = select(Document)
    if doc_type and doc_type in [e.value for e in DocType]:
        query_stmt = query_stmt.where(Document.doc_type == DocType(doc_type))

    # Search across multiple fields
    search_filter = or_(
        Document.title.ilike(f"%{query}%"),
        Document.doc_number.ilike(f"%{query}%"),
        Document.client_name.ilike(f"%{query}%"),
        Document.project_name.ilike(f"%{query}%"),
    )
    query_stmt = query_stmt.where(search_filter).limit(limit)

    result = await db.execute(query_stmt)
    documents = result.scalars().all()

    return [
        {
            "id": str(doc.id),
            "doc_number": doc.doc_number,
            "title": doc.title,
            "doc_type": doc.doc_type.value if doc.doc_type else None,
            "client_name": doc.client_name,
            "project_name": doc.project_name,
            "status": doc.status.value if doc.status else None,
            "file_size": doc.file_size,
        }
        for doc in documents
    ]


async def _tool_request_access(args: dict, user_id: str | None = None, db=None) -> dict:
    """Create an access request for a document."""
    document_id = args.get("document_id", "")
    reason = args.get("reason", "")

    if not user_id or not db:
        return {"error": "Authentication required", "message": "Anda harus login untuk meminta akses."}

    import uuid
    from db.models.access_request import AccessRequest, AccessStatus
    from db.models.document import Document

    # Verify document exists
    doc = await db.get(Document, uuid.UUID(document_id))
    if not doc:
        return {"error": "Document not found", "message": f"Dokumen dengan ID {document_id} tidak ditemukan."}

    # Create access request
    access_req = AccessRequest(
        document_id=uuid.UUID(document_id),
        requested_by=uuid.UUID(user_id),
        reason=reason,
        status=AccessStatus.pending,
    )
    db.add(access_req)
    await db.flush()
    await db.refresh(access_req)

    return {
        "id": str(access_req.id),
        "document_id": document_id,
        "status": "pending",
        "message": f"Permintaan akses untuk dokumen \"{doc.title}\" telah diajukan. Admin akan memproses permintaan Anda.",
    }


async def check_ollama_status() -> dict:
    """Check if Ollama server is running and list available models."""
    ollama_url = settings.ollama_base_url.rstrip("/")
    headers = _get_auth_headers()

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{ollama_url}/api/tags", headers=headers)
            if response.status_code == 200:
                data = response.json()
                models = [m.get("name", "") for m in data.get("models", [])]
                return {
                    "status": "online",
                    "url": ollama_url,
                    "models": models,
                    "default_model": settings.ollama_model,
                }
            else:
                return {
                    "status": "error",
                    "url": ollama_url,
                    "error": f"Ollama returned status {response.status_code}",
                }
    except httpx.ConnectError:
        return {
            "status": "offline",
            "url": ollama_url,
            "error": "Cannot connect to Ollama server",
        }
    except Exception as e:
        return {
            "status": "error",
            "url": ollama_url,
            "error": str(e),
        }