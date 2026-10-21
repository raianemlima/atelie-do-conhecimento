import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseConfig } from "@/lib/supabase/config";

export async function proxy(request: NextRequest) {
  const { url, key } = getSupabaseConfig();
  const pathname = request.nextUrl.pathname;
  const isPublic = pathname === "/login" || pathname === "/configuracao" || pathname.startsWith("/auth");

  if (!url || !key) {
    if (isPublic) return NextResponse.next();
    return NextResponse.redirect(new URL("/configuracao", request.url));
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() { return request.cookies.getAll(); },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();

  if (!user && !isPublic) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: { code: "unauthenticated", message: "Sua sessão expirou. Entre novamente para continuar." } }, { status: 401 });
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (user && pathname === "/login") return NextResponse.redirect(new URL("/", request.url));
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|css|js)$).*)"],
};
