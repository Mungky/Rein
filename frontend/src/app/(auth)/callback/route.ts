import { NextRequest, NextResponse } from "next/server";
import { safeNextPath } from "@/lib/auth/next-path";
import { createMiddlewareClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  // Only allow same-site relative paths — reject absolute URLs and
  // protocol-relative ("//evil.com") to prevent an open redirect (S-1).
  const next = safeNextPath(request.nextUrl.search);

  if (!code) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const { supabase } = createMiddlewareClient(request);

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("Auth callback error:", error.message);
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.redirect(new URL(next, request.url));
}