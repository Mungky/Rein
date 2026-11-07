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
 *  Dicocokkan sebagai awalan. */
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/dcc",
  "/approvals",
  "/admin",
  "/workspace",
  "/m",
];

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

export async function proxy(request: NextRequest) {
  const { supabase, response } = createMiddlewareClient(request);
  // Fast-path untuk prefetch link hover Next.js: hindari remote network getUser()
  // jika cookie auth Supabase sudah ada di browser.
  const isPrefetch =
    request.headers.get("next-router-prefetch") === "1" ||
    request.headers.get("purpose") === "prefetch";
  if (isPrefetch) {
    const hasAuthCookie = request.cookies
      .getAll()
      .some(
        (c) =>
          c.name.startsWith("sb-") &&
          (c.name.includes("auth-token") || c.name.includes("access-token"))
      );
    if (hasAuthCookie) {
      return response;
    }
  }


  // Validate the session against the auth server (and refresh it if the access
  // token is stale but the refresh token is still good). getUser() actually
  // verifies the token, unlike getSession() which trusts the cookie as-is — so
  // an expired session is reliably detected here instead of slipping through
  // the gate and stranding the app on a "Memuat profil…" spinner (Masalah G).
  //
  // Catatan: pemanggilan ini juga memperpanjang sesi (refresh token).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // If user is authenticated and visiting login, redirect to DCC (default landing)
  if (user && pathname === "/login") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
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