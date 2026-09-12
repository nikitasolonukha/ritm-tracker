import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const isLogin = request.nextUrl.pathname === "/login";
  const isPasswordRecovery = request.nextUrl.pathname === "/update-password";
  const isServerEndpoint = ["/api/telegram/webhook", "/api/telegram/worker"].includes(request.nextUrl.pathname);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const ownerId = process.env.RITM_OWNER_USER_ID;
  const configured = Boolean(supabaseUrl && supabaseKey && ownerId);
  const demoMode = process.env.RITM_DEMO_MODE === "1" && process.env.VERCEL !== "1";
  if (isServerEndpoint || demoMode) return NextResponse.next();
  if (!configured) return isLogin ? NextResponse.next() : NextResponse.redirect(new URL("/login?reason=not-configured", request.url));
  if (!supabaseUrl || !supabaseKey) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookies: Array<{ name: string; value: string; options: CookieOptions }>) {
        cookies.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  const redirect = (path: string) => {
    const next = NextResponse.redirect(new URL(path, request.url));
    response.cookies.getAll().forEach((cookie) => next.cookies.set(cookie));
    return next;
  };
  if (user && user.id !== ownerId && !isLogin) return redirect("/login?reason=forbidden");
  if (!user && !isLogin && !isPasswordRecovery) return redirect("/login");
  if (user && user.id === ownerId && isLogin) return redirect("/");
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon.svg|sw.js).*)"] };
