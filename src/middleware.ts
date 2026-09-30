import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAuthServiceUnavailable, isRegisteredUser, safeAuthRedirect } from "@/lib/auth";

export async function middleware(request: NextRequest) {
  const isLogin = request.nextUrl.pathname === "/login";
  const isRegister = request.nextUrl.pathname === "/register";
  const isPasswordRecovery = request.nextUrl.pathname === "/update-password";
  const isServerEndpoint = ["/api/telegram/webhook", "/api/telegram/worker", "/api/auth/register"].includes(request.nextUrl.pathname);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const demoMode = process.env.RITM_DEMO_MODE === "1" && process.env.VERCEL !== "1";
  if (isServerEndpoint || demoMode) return NextResponse.next();
  let response = NextResponse.next({ request });
  const refreshedCookies = new Map<string, { name: string; value: string; options: CookieOptions }>();
  const withCookies = (next: NextResponse) => {
    refreshedCookies.forEach(({ name, value, options }) => next.cookies.set(name, value, options));
    next.headers.set("Cache-Control", "private, no-store");
    next.headers.set("Vary", "Cookie");
    return next;
  };
  if (!supabaseUrl || !supabaseKey) {
    if (request.nextUrl.pathname.startsWith("/api/")) return withCookies(NextResponse.json({ error: "not_configured" }, { status: 503 }));
    return withCookies(isLogin || isRegister ? response : NextResponse.redirect(new URL("/login?reason=not-configured", request.url)));
  }
  const redirect = (path: string) => {
    return withCookies(NextResponse.redirect(new URL(path, request.url)));
  };
  const unavailable = () => request.nextUrl.pathname.startsWith("/api/")
    ? withCookies(NextResponse.json({ error: "unavailable" }, { status: 503 }))
    : isLogin || isRegister || isPasswordRecovery ? withCookies(response) : redirect(`/login?reason=unavailable&next=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`);
  let user;
  try {
    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookies: Array<{ name: string; value: string; options: CookieOptions }>) {
          cookies.forEach((cookie) => { request.cookies.set(cookie.name, cookie.value); refreshedCookies.set(cookie.name, cookie); });
          response = NextResponse.next({ request });
          withCookies(response);
        },
      },
    });
    const result = await supabase.auth.getUser();
    if (isAuthServiceUnavailable(result.error)) return unavailable();
    user = !result.error && isRegisteredUser(result.data.user) ? result.data.user : null;
  } catch { return unavailable(); }
  if (!user && request.nextUrl.pathname.startsWith("/api/")) {
    return withCookies(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
  }
  if (!user && !isLogin && !isRegister && !isPasswordRecovery) {
    const reason = request.cookies.getAll().some((cookie) => cookie.name.startsWith("sb-")) ? "&reason=session-expired" : "";
    return redirect(`/login?next=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}${reason}`);
  }
  if (user && (isLogin || isRegister)) return redirect(safeAuthRedirect(request.nextUrl.searchParams.get("next")));
  if (user) response.headers.set("x-ritm-account-id", user.id);
  return withCookies(response);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon.svg|sw.js).*)"] };
