/**
 * Skrip satu kali: ambil refresh token `gmail.send` dari akun pengirim REIN.
 *
 *   pnpm gmail:token
 *
 * Prasyarat di .env: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET.
 * Memakai redirect URI dev yang sudah terdaftar (http://localhost:3000/auth/google/callback),
 * jadi hentikan `pnpm dev` dulu agar port 3000 bebas.
 * Hasil: refresh token dicetak ke terminal — salin sendiri ke GMAIL_REFRESH_TOKEN di .env.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID ?? '';
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '';
const redirectUri = 'http://localhost:3000/auth/google/callback';

if (!clientId || !clientSecret) {
  console.error(
    'Isi GOOGLE_OAUTH_CLIENT_ID dan GOOGLE_OAUTH_CLIENT_SECRET di .env terlebih dahulu.',
  );
  process.exit(1);
}

const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const state = randomBytes(16).toString('base64url');

const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
auth.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: 'code',
  scope: 'https://www.googleapis.com/auth/gmail.send',
  access_type: 'offline',
  prompt: 'consent',
  state,
  code_challenge: challenge,
  code_challenge_method: 'S256',
}).toString();

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', 'http://localhost:3000');
    if (url.pathname !== '/auth/google/callback') {
      res.writeHead(404).end();
      return;
    }
    const done = (msg: string) => {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(msg);
      server.close();
    };
    if (url.searchParams.get('state') !== state) {
      done('State tidak cocok. Jalankan ulang skrip.');
      return;
    }
    const code = url.searchParams.get('code');
    if (!code) {
      done(`Dibatalkan: ${url.searchParams.get('error') ?? 'tanpa kode'}`);
      return;
    }
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }),
    });
    const json = (await tokenRes.json()) as { refresh_token?: string; error?: string };
    if (!json.refresh_token) {
      console.error('Gagal mendapatkan refresh token:', json.error ?? tokenRes.status);
      done('Gagal. Lihat terminal.');
      return;
    }
    console.log('\nBerhasil. Salin baris berikut ke .env (jangan dibagikan):\n');
    console.log(`GMAIL_REFRESH_TOKEN=${json.refresh_token}\n`);
    console.log('Lalu set MAIL_PROVIDER=gmail dan GMAIL_SENDER sesuai akun yang tadi dipilih.');
    done('Selesai. Kembali ke terminal untuk menyalin refresh token. Tab ini boleh ditutup.');
  })();
});

server.listen(3000, () => {
  console.log('Buka URL ini di browser dan login dengan AKUN PENGIRIM REIN:\n');
  console.log(auth.toString());
  console.log('\nMenunggu callback di http://localhost:3000/auth/google/callback …');
});
