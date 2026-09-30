import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { readRegistrationBody } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const respond = (body: Record<string, unknown>, status: number, retryAfter?: string) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...(retryAfter ? { "Retry-After": retryAfter } : {}) } });
  const body = await readRegistrationBody(request, {
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
    vercel: process.env.VERCEL === "1",
    deploymentHost: process.env.VERCEL_URL,
    productionHost: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    localDevelopment: process.env.NODE_ENV === "development",
  });
  if (!body.ok) return respond({ error: body.error, ...(body.message ? { message: body.message } : {}) }, body.status);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) return respond({ error: "not_configured" }, 503);
  // Vercel overwrites this header. On other hosts a single conservative shared bucket is used.
  const forwarded = request.headers.get("x-vercel-forwarded-for");
  const ip = process.env.VERCEL === "1" ? forwarded?.split(",")[0]?.trim() : "local";
  if (!ip || (process.env.VERCEL === "1" && (!isIP(ip) || (forwarded?.length ?? 0) > 256))) return respond({ error: "unavailable" }, 503);
  try {
    const admin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([AbortSignal.timeout(10_000), ...(init?.signal ? [init.signal] : [])]) }) },
    });
    const bucket = createHash("sha256").update(`${key}:${ip}`).digest("hex");
    const limit = await admin.rpc("consume_registration_attempt", { p_bucket: bucket });
    if (limit.error) return respond({ error: "unavailable" }, 503);
    if (limit.data !== true) return respond({ error: "rate_limited" }, 429, "3600");
    const { data, error } = await admin.auth.admin.createUser({ email: body.email, password: body.password, email_confirm: true });
    if (error) {
      if (error.code === "email_exists" || error.code === "user_already_exists") return respond({ error: "email_exists" }, 409);
      if (error.code === "weak_password" || error.code === "email_address_invalid") return respond({ error: error.code }, 400);
      return respond({ error: "unavailable" }, 503);
    }
    if (!data?.user?.id) return respond({ error: "unavailable" }, 503);
    return respond({ created: true }, 201);
  } catch { return respond({ error: "unavailable" }, 503); }
}
