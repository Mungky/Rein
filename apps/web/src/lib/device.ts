/**
 * device_id 128-bit dibuat klien (PRD §5) dan dikirim saat login; server menyimpannya juga
 * sebagai cookie HttpOnly `rein_did`. Dipakai untuk perangkat trusted & PIN (M1).
 */
const KEY = 'rein:device';

export function deviceId(): string | undefined {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return undefined;
  }
}
