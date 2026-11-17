import { Google } from 'arctic';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export { generateCodeVerifier, generateState } from 'arctic';

export interface GoogleClaims {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

/** Abstraksi OIDC Google (FR-006) agar bisa diganti stub di test. */
export interface GoogleOidc {
  authorizationUrl(state: string, codeVerifier: string): URL;
  exchange(code: string, codeVerifier: string): Promise<GoogleClaims>;
}

const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

/** Authorization Code + PKCE; id_token diverifikasi (issuer, audience, expiry) — FR-006 AC4. */
export function createGoogleOidc(cfg: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): GoogleOidc {
  const google = new Google(cfg.clientId, cfg.clientSecret, cfg.redirectUri);
  return {
    authorizationUrl(state, codeVerifier) {
      const url = google.createAuthorizationURL(state, codeVerifier, [
        'openid',
        'email',
        'profile',
      ]);
      url.searchParams.set('prompt', 'select_account');
      return url;
    },
    async exchange(code, codeVerifier) {
      const tokens = await google.validateAuthorizationCode(code, codeVerifier);
      const { payload } = await jwtVerify(tokens.idToken(), JWKS, {
        issuer: ISSUERS,
        audience: cfg.clientId,
      });
      if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
        throw new Error('id_token tanpa sub/email');
      }
      return {
        sub: payload.sub,
        email: payload.email.toLowerCase(),
        emailVerified: payload.email_verified === true,
        ...(typeof payload.name === 'string' ? { name: payload.name } : {}),
      };
    },
  };
}
