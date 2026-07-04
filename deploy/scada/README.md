# SCADA Monitor — Server-Side Streaming Stack

Developer notes. For the step-by-step operator guide (Indonesian), see
[PANDUAN-SERVER-SCADA.md](./PANDUAN-SERVER-SCADA.md).

## Architecture

```
OBS ──RTMP (127.0.0.1:1935)──▶ MediaMTX ──LL-HLS (127.0.0.1:8888)──▶ cloudflared ──▶ https://scada-stream.<domain>
                                                                                          │
                                                              REIN /scada page (hls.js) ◀┘
```

- **Why HLS, not WebRTC:** Cloudflare Tunnel only carries HTTP/HTTPS/WebSocket.
  WebRTC media (ICE over UDP/TCP) does not traverse it. LL-HLS gives ~3–6 s
  latency, acceptable for monitoring. If LL-HLS misbehaves through the proxy,
  set `hlsVariant: mpegts` in `mediamtx.yml` (~6–10 s latency).
- **Auth:** MediaMTX `authInternalUsers` — publisher (`obs`) is IP-locked to
  localhost; reader (`rein-viewer`) credentials are stored in REIN's
  `scada_streams` table and sent by the player as an `Authorization: Basic`
  header on every request (query-param auth is NOT supported for HLS reads
  in modern MediaMTX — verified on v1.19; RTMP publish still accepts
  `?user=&pass=` in the stream key). Anonymous access is denied. CORS is
  locked to the REIN frontend origin.
- **Self-healing:** MediaMTX + cloudflared run as NSSM services
  (`AppExitAction Restart`, 5 s delay). OBS runs via a logon scheduled task
  with `--startstreaming` (it needs a desktop session, so it cannot be a
  service; Windows auto-logon is required). The REIN video panel retries
  forever with capped backoff and has a stale-frame watchdog.
- **OBS keyframe interval must be 1 s** to match `hlsSegmentDuration`.

## Files

| File | Purpose |
|---|---|
| `mediamtx.yml` | MediaMTX config (RTMP ingest, LL-HLS output, auth) — MediaMTX ≥ 1.9 |
| `cloudflared-config.yml` | Named-tunnel ingress template |
| `install-services.ps1` | Idempotent NSSM + Task Scheduler installer |
| `PANDUAN-SERVER-SCADA.md` | Non-technical setup guide (Indonesian) |

## Future: client deployments (Docker)

MediaMTX (`bluenviron/mediamtx`) and cloudflared (`cloudflare/cloudflared`)
both ship official images; the yml files here map 1:1 to container configs.
OBS stays on the host (needs GPU/desktop) and publishes RTMP to the
container's mapped port.
