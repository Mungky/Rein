/** Gerbang autentikasi seluruh REIN — dijalankan sebelum setiap navigasi.
 *
 *  Berkas ini bernama `proxy.ts`, bukan `middleware.ts`, dan ekspornya `proxy`,
 *  bukan `middleware`. Next.js 16 mendeprekasi nama lamanya — lihat
 *  node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md.
 *  Runtime `proxy` selalu nodejs dan tidak bisa dikonfigurasi; kita memang tidak
 *  memakai runtime edge di sini. */

import { NextRequest, NextResponse } from "next/server";
import { createMiddlewareClient } from "@/lib/supabase/server";

/** Halaman yang menuntut sesi login yang sah.
 *
 *  `/r-net` dan `/m` DULU TIDAK ADA di daftar ini, dan itu bukan kelalaian
 *  kecil: matcher di bawah mencocokkan keduanya, jadi gerbang ini benar-benar
 *  berjalan untuk mereka — memanggil getUser(), lalu melewatkannya begitu saja.
 *  Satu-satunya penjaga yang tersisa ada di sisi klien, yang baru bekerja
 *  SETELAH halamannya terkirim dan React sempat jalan.
 *
 *  Dicocokkan sebagai awalan: "/r-net" dan "/r-net/apa-pun" sama-sama terjaga,
 *  tapi nama lain yang kebetulan berawalan sama (mis. "/r-net-publik") tidak
 *  ikut terseret karena pemisah "/"-nya diwajibkan. */
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/dcc",
  "/approvals",
  "/admin",
  "/workspace",
  "/r-net",
  "/m",
];

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

export async function proxy(request: NextRequest) {
  const { supabase, response } = createMiddlewareClient(request);

  // Validate the session against the auth server (and refresh it if the access
  // token is stale but the refresh token is still good). getUser() actually
  // verifies the token, unlike getSession() which trusts the cookie as-is — so
  // an expired session is reliably detected here instead of slipping through
  // the gate and stranding the app on a "Memuat profil…" spinner (Masalah G).
  //
  // PERHATIKAN AKIBAT SAMPINGANNYA, karena inilah jawaban sebenarnya atas
  // "sesi habis tapi saya masih bisa buka apa saja": pemanggilan ini juga
  // MEMPERPANJANG sesinya. Selama refresh token masih hidup, setiap navigasi
  // menerbitkan access token baru — jadi sesi tidak pernah kedaluwarsa dengan
  // sendirinya, seberapa lama pun ditinggal. Menambah baris ke daftar terjaga
  // di atas tidak mengubah itu sama sekali; yang mengubahnya adalah batas diam
  // di sisi R-Net (features/scada/use-idle.ts).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // If user is authenticated and visiting login, redirect to DCC (default landing)
  if (user && pathname === "/login") {
    return NextResponse.redirect(new URL("/dcc", request.url));
  }

  // If user is not authenticated and trying to access a protected route, redirect to login
  if (!user && isProtectedPath(pathname)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico (favicon)
     * - public folder assets
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};