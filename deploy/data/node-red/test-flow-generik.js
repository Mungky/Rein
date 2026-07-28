// Uji kotak "Tempel Label" di flow-generik-bulk.json TANPA menjalankan
// Node-RED dan TANPA menyentuh broker. Jalankan dari folder repo:
//
//     node deploy/data/node-red/test-flow-generik.js
//
// Jalankan ini setiap kali flow disunting di Node-RED lalu diekspor ulang ke
// repo. Blok 6 memakai rekaman payload ASLI dari gateway lapangan — di situlah
// ketahuan bahwa parseFloat() membaca nomor seri gateway Line 2
// ("31c73eb9...") sebagai angka 31 dan mengirimkannya sebagai sensor palsu.
const fs = require('fs');
const flow = JSON.parse(fs.readFileSync(
  'D:/006 Restard/Rein v1/deploy/data/node-red/flow-generik-bulk.json', 'utf8'));
const src = flow.find(n => n.type === 'function').func;
const body = new Function('msg', 'context', 'node', src);

const store = {};
const context = { get: k => store[k], set: (k, v) => { store[k] = v; } };
const warns = [];
const status = [];
const node = { warn: m => warns.push(m), status: s => status.push(s.text) };
const run = msg => body(msg, context, node);

let fail = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? '  PASS  ' : '  GAGAL ') + name + (extra ? '  -> ' + extra : ''));
  if (!cond) fail++;
};

// Bentuk payload gateway V-Box seperti yang dipakai flow lama.
const gwMsg = (gw, d) => ({ topic: 'fikri/vnet/' + gw, payload: { data: d } });
const L1 = { waterlevel1: 12.5, waterlevel2: 30.1, waterlevel3: 44, waterlevel4: 7.75,
             temperature1: 71.2, temperature2: 68.9, temperature3: 25.4 };
const L2 = { waterlevel1: 10, waterlevel2: 20, waterlevel3: 30, waterlevel4: 40,
             temperature1: 50, temperature2: 60, temperature3: 70 };

console.log('\n1. Satu pesan gateway = satu paket, seketika');
let out = run(gwMsg('lombok1', L1));
ok('paket langsung keluar', !!out);
ok('topik per GATEWAY, bukan per plant', out.topic === 'rnet/lombok/gw/lombok1', out.topic);
ok('7 nilai gateway itu', Object.keys(out.payload.values).length === 7);
ok('kunci tanpa awalan gateway', out.payload.values['waterlevel1'] === 12.5);
ok('site/gateway/ts lengkap', out.payload.site === 'lombok' &&
   out.payload.gateway === 'lombok1' && !isNaN(Date.parse(out.payload.ts)));
console.log('     contoh:', JSON.stringify(out.payload).slice(0, 120) + '...');

console.log('\n2. TIDAK ADA nilai yang tertimpa (cacat versi denyut 1 detik)');
// Dua pesan gateway dalam waktu sangat berdekatan: versi lama membuang yang
// pertama. Versi ini harus menerbitkan keduanya.
const a = run(gwMsg('lombok1', { waterlevel1: 111 }));
const b = run(gwMsg('lombok1', { waterlevel1: 222 }));
ok('pesan pertama tetap terkirim', a && a.payload.values['waterlevel1'] === 111);
ok('pesan kedua juga terkirim', b && b.payload.values['waterlevel1'] === 222);

console.log('\n3. Tiap gateway berdiri sendiri');
// Kuncinya sekarang identik antar gateway ('waterlevel1' di keduanya), jadi
// yang memisahkan mereka adalah TOPIK dan kolom gateway — bukan lagi awalan
// nama di setiap kunci. Justru itu yang harus dipastikan di sini.
const p1 = run(gwMsg('lombok1', L1));
const p2 = run(gwMsg('lombok2', L2));
ok('topik memisahkan kedua gateway',
   p1.topic === 'rnet/lombok/gw/lombok1' && p2.topic === 'rnet/lombok/gw/lombok2',
   p1.topic + ' / ' + p2.topic);
ok('kolom gateway ikut menandai', p1.payload.gateway === 'lombok1' &&
   p2.payload.gateway === 'lombok2');
ok('nilai tidak tertukar antar gateway',
   p1.payload.values['waterlevel1'] === 12.5 &&
   p2.payload.values['waterlevel1'] === 10);

console.log('\n4. Gateway BARU (Line 3) tertangkap tanpa flow diubah');
warns.length = 0;
out = run(gwMsg('lombok3', { waterlevel1: 1.5, temperature1: 80 }));
ok('lombok3 langsung terkirim', out.payload.values['waterlevel1'] === 1.5);
ok('topiknya ikut terbentuk sendiri', out.topic === 'rnet/lombok/gw/lombok3', out.topic);
ok('ada peringatan gateway baru', warns.some(w => w.includes('lombok3')), warns[0]);

console.log('\n5. Nilai rusak dibuang, sensor lain di pesan sama tetap jalan');
out = run(gwMsg('lombok1', { waterlevel1: 'NaN', waterlevel2: null, waterlevel3: 5,
                             waterlevel4: 'abc', temperature1: '12.5' }));
const v = out.payload.values;
ok('NaN/null/teks-rusak dibuang', !('waterlevel1' in v) &&
   !('waterlevel2' in v) && !('waterlevel4' in v));
ok('angka sehat lolos', v['waterlevel3'] === 5);
ok('angka berbentuk teks ikut diselamatkan', v['temperature1'] === 12.5);

console.log('\n6. Payload ASLI lapangan (rekaman 27 Juli 2026)');
const R1 = run({ topic: 'fikri/vnet/lombok1', payload: { timestamp: 1785141150,
  messageId: 1, event: 'test_data', mfrs: 'V-Box',
  data: { id: 'c8e369e9c727dae5c8e2e739dcdb5591', temperature3: 81.25,
  temperature2: 89.820960998535, temperature1: 90.785011291504, waterlevel1: 12,
  waterlevel3: 9, waterlevel2: 11, waterlevel4: 93 } } });
const R2 = run({ topic: 'fikri/vnet/lombok2', payload: { data: { waterlevel4: 93,
  waterlevel3: 9, waterlevel2: 11, temperature2: 42.851852416992,
  id: '31c73eb96aaf3a7fece51f8d1deeec91', temperature1: 43.252025604248,
  temperature3: 40.270397186279, waterlevel1: 5 }, timestamp: 1785141150,
  mfrs: 'V-Box', event: 'test_data', messageId: 1 } });
ok('7 sensor per gateway (bukan 8)',
   Object.keys(R1.payload.values).length === 7 &&
   Object.keys(R2.payload.values).length === 7,
   Object.keys(R1.payload.values).length + ' / ' + Object.keys(R2.payload.values).length);
ok('nomor seri lombok1 tidak jadi sensor', !('id' in R1.payload.values));
ok('nomor seri lombok2 "31c73eb9..." TIDAK dibaca sebagai 31',
   !('id' in R2.payload.values),
   'id = ' + R2.payload.values['id']);
ok('timestamp/messageId/event/mfrs tidak ikut jadi sensor',
   !Object.keys(R1.payload.values).some(k => /timestamp|messageId|event|mfrs/.test(k)));
ok('nilai sensor asli utuh', R1.payload.values['temperature1'] === 90.785011291504);

console.log('\n7. Payload aneh tidak membuat flow mati');
ok('teks mentah bukan JSON', run({ topic: 'fikri/vnet/lombok1', payload: 'rusak' }) === null);
ok('payload kosong', run({ topic: 'fikri/vnet/lombok1', payload: null }) === null);
ok('tanpa .data (dibaca rata)', (() => {
  const o = run({ topic: 'fikri/vnet/lombok9', payload: { suhu: 30 } });
  return o && o.payload.values['suhu'] === 30;
})());
ok('JSON berbentuk teks tetap terbaca', (() => {
  const o = run({ topic: 'fikri/vnet/lombok1', payload: JSON.stringify({ data: { x: 3 } }) });
  return o && o.payload.values['x'] === 3;
})());
ok('pesan tanpa angka sama sekali', run(gwMsg('lombok1', { id: 'abc' })) === null);

console.log('\n8. SATU GATEWAY MATI — gateway lain harus tetap jalan');
// Titik rawan khas desain payload gabungan. Selama 17 jam pemantauan lapangan
// kejadian ini TIDAK PERNAH muncul sendirian (semua 102 gangguan menimpa kedua
// gateway sekaligus), jadi harus diuji sengaja di sini.
let bertahan = 0;
for (let s = 0; s < 20; s++) {          // lombok1 diam total 20 siklus
  const o = run(gwMsg('lombok2', { waterlevel1: 10 + s, temperature1: 50 + s }));
  if (o && o.payload.values['waterlevel1'] === 10 + s) bertahan++;
}
ok('lombok2 lolos 20/20 siklus saat lombok1 mati', bertahan === 20, bertahan + '/20');
ok('tidak ada sisa nilai basi dari lombok1', (() => {
  // Sejak kunci tidak lagi berawalan nama gateway, "kebocoran" tidak bisa lagi
  // dideteksi dari nama kunci — nilai lombok1 yang tertinggal akan terlihat
  // persis seperti nilai lombok2. Yang membuktikannya sekarang: paket ini
  // harus berisi TEPAT satu nilai (yang barusan dikirim), padahal lombok1
  // sebelumnya mengirim 7. Kalau ada penampung antar-pesan, jumlahnya bengkak.
  const o = run(gwMsg('lombok2', { waterlevel1: 77 }));
  return o.topic === 'rnet/lombok/gw/lombok2' &&
         Object.keys(o.payload.values).length === 1 &&
         o.payload.values['waterlevel1'] === 77;
})());
ok('lombok1 pulih langsung ikut lagi', (() => {
  const o = run(gwMsg('lombok1', L1));
  return o.payload.values['temperature1'] === 71.2;
})());

console.log('\n9. Beban 300 sensor (10 gateway x 30 field)');
const t0 = Date.now();
let paket = 0, nilai = 0;
for (let s = 0; s < 60; s++) {
  for (let g = 1; g <= 10; g++) {
    const d = {};
    for (let i = 1; i <= 30; i++) d['sensor' + i] = Math.random() * 100;
    const o = run({ topic: 'fikri/vnet/gw' + g, payload: { data: d } });
    if (o) { paket++; nilai += Object.keys(o.payload.values).length; }
  }
}
const ms = Date.now() - t0;
ok('semua 600 paket terkirim, nol tertimpa', paket === 600, paket + '/600');
ok('300 nilai per siklus', nilai / 60 === 300, (nilai / 60) + ' nilai/siklus');
ok('60 siklus beban penuh < 500 ms', ms < 500, ms + ' ms');
console.log('     per siklus: 10 paket MQTT (cara lama: 300 pesan)');

console.log('\n' + (fail === 0 ? 'SEMUA LULUS' : fail + ' GAGAL'));
process.exit(fail ? 1 : 0);
