import { NextRequest, NextResponse } from "next/server";
import { createMiddlewareClient } from "@/lib/supabase/server";



function isProtectedPath(pathname: string): boolean {
  const protectedPrefixes = ["/dashboard", "/dcc", "/approvals", "/admin", "/workspace"];
  return protectedPrefixes.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export async function middleware(request: NextRequest) {
  const { supabase, response } = createMiddlewareClient(request);

  // Validate the session against the auth server (and refresh it if the access
  // token is stale but the refresh token is still good). getUser() actually
  // verifies the token, unlike getSession() which trusts the cookie as-is — so
  // an expired session is reliably detected here instead of slipping through
  // the gate and stranding the app on a "Memuat profil…" spinner (Masalah G).
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