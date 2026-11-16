/**
 * Template email auth — HTML ringan (≤ 30 KB, tanpa gambar eksternal) + plain text (PRD §6.3).
 * Semua variabel di-escape.
 */
export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

const VPN_NOTE = 'Tautan hanya dapat dibuka dari jaringan kantor atau VPN.';

function layout(title: string, body: string): string {
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)}</title></head>
<body style="margin:0;background:#f6f6f8;font-family:Inter,Segoe UI,Roboto,Arial,sans-serif;color:#161619">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#fff;border:1px solid #e6e6ea;border-radius:12px">
<tr><td style="padding:20px 24px;border-bottom:1px solid #e6e6ea;font-weight:600;font-size:14px">
<span style="display:inline-block;width:20px;height:20px;line-height:20px;text-align:center;border-radius:5px;background:#4f6bed;color:#fff;font-size:11px;margin-right:8px">R</span>REIN · Remula</td></tr>
<tr><td style="padding:24px;font-size:14px;line-height:22px">${body}</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #e6e6ea;font-size:12px;line-height:18px;color:#8e8e97">${esc(VPN_NOTE)}<br>Email otomatis dari REIN — PT Remula Inti Rekayasa. Jangan balas email ini.</td></tr>
</table></td></tr></table></body></html>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:20px 0"><a href="${esc(href)}" style="display:inline-block;background:#4f6bed;color:#fff;text-decoration:none;font-weight:500;padding:10px 16px;border-radius:6px">${esc(label)}</a></p>`;
}

export function notificationMail(title: string, body: string, link: string): RenderedMail {
  return {
    subject: `[REIN] ${title}`,
    html: layout(title, `<p>${esc(body)}</p>${button(link, 'Buka REIN')}`),
    text: `${title}\n\n${body}\n\n${link}\n${VPN_NOTE}`,
  };
}

export function activationMail(p: {
  name: string;
  inviterName: string;
  username: string;
  link: string;
}): RenderedMail {
  const subject = '[REIN] Aktivasi akun Anda';
  const html = layout(
    subject,
    `<p style="margin:0 0 12px">Halo ${esc(p.name)},</p>
<p style="margin:0 0 12px">${esc(p.inviterName)} mengundang Anda ke <b>REIN</b>, aplikasi pelacakan project PT Remula Inti Rekayasa. Username Anda: <b>${esc(p.username)}</b>.</p>
<p style="margin:0">Klik tombol di bawah untuk membuat password. Tautan berlaku <b>72 jam</b> dan hanya bisa dipakai sekali.</p>
${button(p.link, 'Aktifkan akun')}
<p style="margin:0;font-size:12px;color:#5a5a63">Jika tombol tidak berfungsi, salin tautan ini:<br><span style="word-break:break-all">${esc(p.link)}</span></p>`,
  );
  const text = `Halo ${p.name},

${p.inviterName} mengundang Anda ke REIN, aplikasi pelacakan project PT Remula Inti Rekayasa.
Username: ${p.username}

Buat password lewat tautan berikut (berlaku 72 jam, sekali pakai):
${p.link}

${VPN_NOTE}`;
  return { subject, html, text };
}

export function verifyEmailMail(p: { name: string; code: string; link: string }): RenderedMail {
  const subject = `[REIN] Kode verifikasi email: ${p.code}`;
  const html = layout(
    subject,
    `<p style="margin:0 0 12px">Halo ${esc(p.name)},</p>
<p style="margin:0 0 12px">Masukkan kode berikut di REIN untuk memverifikasi email Anda:</p>
<p style="margin:0 0 16px;font-size:28px;line-height:36px;font-weight:600;letter-spacing:6px">${esc(p.code)}</p>
<p style="margin:0">Atau klik tombol ini untuk verifikasi otomatis. Kode dan tautan berlaku <b>15 menit</b>.</p>
${button(p.link, 'Verifikasi email')}
<p style="margin:0;font-size:12px;color:#5a5a63">Jangan berikan kode ini kepada siapa pun. Abaikan email ini jika Anda tidak meminta verifikasi.</p>`,
  );
  const text = `Halo ${p.name},

Kode verifikasi email REIN Anda: ${p.code}
Atau buka tautan ini: ${p.link}
Berlaku 15 menit. Jangan berikan kode ini kepada siapa pun.

${VPN_NOTE}`;
  return { subject, html, text };
}
