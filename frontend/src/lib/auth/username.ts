/**
 * Username <-> synthetic-email helpers.
 *
 * The app stores username as the canonical identifier for users; Supabase Auth
 * however still requires an email. We therefore map every username to a
 * synthetic email under the `rein.internal` domain. Users never see this email
 * — they only ever type their username. The backend uses the same mapping
 * when creating accounts via the admin API.
 */

export const SYNTHETIC_EMAIL_DOMAIN = "rein.internal";

const USERNAME_RE = /^[a-z0-9](?:[a-z0-9._-]{0,30}[a-z0-9])?$/;

export function isValidUsername(value: string): boolean {
  return USERNAME_RE.test(value);
}

export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

export function emailToUsername(email: string | null | undefined): string {
  if (!email) return "";
  const at = email.indexOf("@");
  return at > 0 ? email.slice(0, at) : email;
}
