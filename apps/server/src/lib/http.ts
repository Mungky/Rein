import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';

/** Error API terstruktur: `{ error: { code, message, fields? } }`. Pesan dalam Bahasa Indonesia. */
export class HttpError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
  }
}

export const badRequest = (message = 'Permintaan tidak valid') =>
  new HttpError(400, 'BAD_REQUEST', message);
export const unauthorized = (message = 'Silakan masuk terlebih dahulu') =>
  new HttpError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'Anda tidak punya izin untuk aksi ini') =>
  new HttpError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Data tidak ditemukan') =>
  new HttpError(404, 'NOT_FOUND', message);

/** Parse body JSON + validasi Zod; error validasi → 422 dengan pesan per field. */
export async function readJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest('Body harus berupa JSON');
  }
  return validate(schema, raw);
}

export function validate<S extends z.ZodType>(schema: S, raw: unknown): z.infer<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || '_';
      fields[key] ??= issue.message;
    }
    throw new HttpError(422, 'VALIDATION', 'Periksa kembali isian Anda', fields);
  }
  return parsed.data;
}
