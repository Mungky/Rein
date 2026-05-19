import { NextRequest, NextResponse } from "next/server";
import { createMiddlewareClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dcc";

  if (!code) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const { supabase, response } = createMiddlewareClient(request);

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("Auth callback error:", error.message);
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.redirect(new URL(next, request.url));
}