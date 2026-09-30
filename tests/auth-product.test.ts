import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as auth from "../src/lib/auth.ts";

const require = createRequire(import.meta.url);
const { NextRequest } = require("next/server") as typeof import("next/server");
const origin = "https://ritm.test";
const configured = { NEXT_PUBLIC_SUPABASE_URL: "https://fixture.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fixture-public-key", SUPABASE_SERVICE_ROLE_KEY: "fixture-server-key", VERCEL: "1" };

// Run the actual handlers with real Next request/cookie classes, without a network or real accounts.
function loadHandler(path: string, replacements: Record<string, unknown>, env: Record<string, string | undefined>) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const cjsModule = { exports: {} };
  vm.runInNewContext(compiled, {
    module: cjsModule, exports: cjsModule.exports,
    require: (name: string) => name === "@/lib/auth" ? auth : name in replacements ? replacements[name] : require(name),
    process: { env }, URL, TextDecoder, Uint8Array, AbortSignal, fetch,
  }, { filename: path });
  return cjsModule.exports;
}

type RegistrationResult = { data?: { user: { id: string } | null }; error: { code?: string; status?: number; message?: string } | null };
type RateResult = { data: unknown; error: unknown };
function registrationHandler(options: { env?: Record<string, string | undefined>; rate?: RateResult; result?: RegistrationResult; throws?: boolean } = {}) {
  const calls: { method: string; value: unknown }[] = [];
  const admin = {
    rpc: async (name: string, args: unknown) => { calls.push({ method: name, value: args }); if (options.throws) throw new Error("private server detail"); return options.rate ?? { data: true, error: null }; },
    auth: { admin: { createUser: async (input: unknown) => { calls.push({ method: "createUser", value: input }); return options.result ?? { data: { user: { id: "fixture-new-user" } }, error: null }; } } },
  };
  const handler = loadHandler("../src/app/api/auth/register/route.ts", { "@supabase/supabase-js": { createClient: (_url: string, key: string) => { calls.push({ method: "client", value: key }); return admin; } } }, options.env ?? configured) as { POST: (request: InstanceType<typeof NextRequest>) => Promise<Response> };
  return { post: handler.POST, calls };
}

function registrationRequest(body: unknown = { email: "Fixture@Example.test", password: " precise-password " }, headers: Record<string, string> = {}) {
  return new NextRequest(`${origin}/api/auth/register`, { method: "POST", headers: { origin, "content-type": "application/json", "x-vercel-forwarded-for": "203.0.113.7", ...headers }, body: JSON.stringify(body) });
}

type VerifiedUser = { id: string; email?: string; is_anonymous?: boolean } | null;
type CookiesAdapter = { setAll: (cookies: { name: string; value: string; options: { path: string; httpOnly?: boolean } }[]) => void };
function middlewareHandler(options: { user?: VerifiedUser; env?: Record<string, string | undefined>; error?: { status?: number; code?: string; name?: string }; throws?: boolean; constructorThrows?: boolean; refresh?: boolean } = {}) {
  let verified = 0;
  const middleware = loadHandler("../src/middleware.ts", {
    "@supabase/ssr": { createServerClient: (_url: string, _key: string, adapters: { cookies: CookiesAdapter }) => {
      if (options.constructorThrows) throw new Error("invalid config detail");
      return { auth: { getUser: async () => {
        verified += 1;
        if (options.refresh) {
          adapters.cookies.setAll([{ name: "sb-fixture-refresh", value: "renewed", options: { path: "/", httpOnly: true } }]);
          adapters.cookies.setAll([{ name: "sb-fixture-access", value: "verified", options: { path: "/" } }]);
        }
        if (options.throws) throw new Error("private auth connection detail");
        return { data: { user: options.user ?? null }, error: options.error ?? null };
      } } };
    } },
  }, options.env ?? configured) as { middleware: (request: InstanceType<typeof NextRequest>) => Promise<InstanceType<typeof import("next/server").NextResponse>> };
  return { run: (path = "/today", headers: Record<string, string> = {}) => middleware.middleware(new NextRequest(origin + path, { headers })), verified: () => verified };
}

test("registration validation normalizes only email, never the password", async () => {
  assert.equal(auth.validateRegistration("fixture@example.test", "        "), "Пароль должен содержать от 8 до 128 символов и не состоять только из пробелов.");
  assert.equal(auth.validateRegistration("fixture@example.test", "a".repeat(129)), "Пароль должен содержать от 8 до 128 символов и не состоять только из пробелов.");
  assert.ok(auth.validateRegistration({ email: "fixture@example.test" }, "password"));
  assert.equal(auth.validateEmail("bad\r\n@example.test"), "Введите корректный email.");
  const parsed = await auth.readRegistrationBody(registrationRequest());
  assert.deepEqual(parsed, { ok: true, email: "fixture@example.test", password: " precise-password " });
});

test("post-login destinations never become open redirects or auth/API loops", () => {
  for (const value of [null, "https://evil.test", "//evil.test", "/\\evil.test", "/today\n", "/login", "/register?next=/today", "/update-password", "/api/sync", "/x/../api/sync", "/_next/static/a.js"]) assert.equal(auth.safeAuthRedirect(value), "/today");
  assert.equal(auth.safeAuthRedirect("/workout/fixture?tab=sets#current"), "/workout/fixture?tab=sets#current");
});

test("registration requires same-origin JSON and blocks cross-site requests before privileged work", async () => {
  const handler = registrationHandler();
  const attempts: Record<string, string>[] = [{ origin: "https://evil.test" }, { origin: "" }, { "sec-fetch-site": "cross-site" }];
  for (const headers of attempts) assert.equal((await handler.post(registrationRequest(undefined, headers))).status, 403);
  assert.equal((await handler.post(registrationRequest(undefined, { "content-type": "text/plain" }))).status, 415);
  assert.equal(handler.calls.length, 0);
});

test("Next local URL normalization preserves same-origin registration without trusting forwarded hosts", async () => {
  const headers = { origin: "http://127.0.0.1:3004", host: "127.0.0.1:3004", "content-type": "application/json", "sec-fetch-site": "same-origin" };
  const request = new NextRequest("http://localhost:3004/api/auth/register", { method: "POST", headers, body: JSON.stringify({ email: "fixture@example.test", password: "password-fixture" }) });
  const handler = registrationHandler({ env: { ...configured, VERCEL: undefined, NODE_ENV: "development", NEXT_PUBLIC_APP_URL: "http://localhost:3000" } });
  assert.equal((await handler.post(request)).status, 201);
  const policy = { localDevelopment: true };
  const attacks: Record<string, string>[] = [
    { origin: "http://evil.test:3004", host: "evil.test:3004" },
    { origin: "http://127.0.0.1:3005", host: "127.0.0.1:3005" },
    { host: "localhost:3004", "x-forwarded-host": "127.0.0.1:3004" },
    { origin: "http://localhost:3004" },
    { "sec-fetch-site": "cross-site" },
  ];
  for (const changed of attacks) {
    const attack = new Request("http://localhost:3004/api/auth/register", { headers: { ...headers, ...changed } });
    assert.equal(auth.isRegistrationOriginAllowed(attack, policy), false);
  }
  assert.equal(auth.isRegistrationOriginAllowed(new Request("http://localhost:3004/api/auth/register", { headers }), { vercel: true, localDevelopment: true }), false);
  assert.equal(auth.isRegistrationOriginAllowed(new Request("http://localhost:3004/api/auth/register", { headers })), false);
});

test("a reverse-proxy origin must match configured deployment and public host", () => {
  const request = new Request("http://localhost:3000/api/auth/register", { headers: { origin, host: "internal.test", "x-forwarded-host": "ritm.test", "sec-fetch-site": "same-origin" } });
  assert.equal(auth.isRegistrationOriginAllowed(request, { appUrl: origin, vercel: true }), true);
  assert.equal(auth.isRegistrationOriginAllowed(request, { appUrl: origin }), false);
  assert.equal(auth.isRegistrationOriginAllowed(request, { vercel: true }), false);
  const forged = new Request("http://localhost:3000/api/auth/register", { headers: { origin: "https://evil.test", host: "internal.test", "x-forwarded-host": "evil.test" } });
  assert.equal(auth.isRegistrationOriginAllowed(forged, { appUrl: origin, vercel: true }), false);
  const preview = new Request("http://localhost:3000/api/auth/register", { headers: { origin: "https://preview.vercel.app", "x-forwarded-host": "preview.vercel.app" } });
  assert.equal(auth.isRegistrationOriginAllowed(preview, { vercel: true, deploymentHost: "preview.vercel.app" }), true);
  assert.equal(auth.isRegistrationOriginAllowed(preview, { vercel: true, deploymentHost: "preview.vercel.app/evil" }), false);
});

test("registration bounds actual bytes even without a reliable Content-Length", async () => {
  const lengths: Record<string, string>[] = [{}, { "content-length": "1" }, { "content-length": "3000" }];
  for (const headers of lengths) {
    const handler = registrationHandler();
    const response = await handler.post(registrationRequest({ email: "fixture@example.test", password: "a".repeat(3000) }, headers));
    assert.equal(response.status, 413);
    assert.equal(handler.calls.length, 0);
  }
  const invalid = await auth.readRegistrationBody(registrationRequest(undefined, { "content-length": "NaN" }));
  assert.equal(invalid.ok ? 0 : invalid.status, 400);
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(1024)); controller.enqueue(new Uint8Array(1024)); controller.enqueue(new Uint8Array(1)); },
    cancel() { cancelled = true; },
  });
  const init: RequestInit & { duplex: "half" } = { method: "POST", headers: { origin, "content-type": "application/json" }, body, duplex: "half" };
  const streamed = await auth.readRegistrationBody(new Request(`${origin}/api/auth/register`, init));
  assert.equal(streamed.ok ? 0 : streamed.status, 413);
  assert.equal(cancelled, true);
});

test("registration rejects malformed, array, and invalid UTF-8 bodies", async () => {
  for (const body of ["{", "[]", "null", "{}", '"password"']) {
    const request = new Request(`${origin}/api/auth/register`, { method: "POST", headers: { origin, "content-type": "application/json" }, body });
    const result = await auth.readRegistrationBody(request);
    assert.equal(result.ok ? 0 : result.status, 400);
  }
  const invalidUtf8 = new Request(`${origin}/api/auth/register`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: new Uint8Array([0xff]) });
  const result = await auth.readRegistrationBody(invalidUtf8);
  assert.equal(result.ok ? 0 : result.status, 400);
});

test("successful registration consumes a durable bucket then creates a confirmed email account", async () => {
  const handler = registrationHandler();
  const response = await handler.post(registrationRequest({ email: "Fixture@Example.test", password: " precise-password ", user_id: "owner", app_metadata: { role: "admin" }, email_confirm: false }));
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { created: true });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(handler.calls.map((call) => call.method), ["client", "consume_registration_attempt", "createUser"]);
  assert.match((handler.calls[1].value as { p_bucket: string }).p_bucket, /^[a-f0-9]{64}$/);
  const creation = handler.calls[2].value as Record<string, unknown>;
  assert.equal(creation.email, "fixture@example.test");
  assert.equal(creation.password, " precise-password ");
  assert.equal(creation.email_confirm, true);
  assert.equal(Object.keys(creation).length, 3);
});

test("registration fails closed for missing config or invalid trusted IP", async () => {
  for (const env of [{}, { ...configured, SUPABASE_SERVICE_ROLE_KEY: undefined }, { ...configured, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined }]) {
    const handler = registrationHandler({ env });
    const response = await handler.post(registrationRequest());
    assert.equal(response.status, 503);
    assert.equal(handler.calls.length, 0);
  }
  const handler = registrationHandler();
  assert.equal((await handler.post(registrationRequest(undefined, { "x-vercel-forwarded-for": "not-an-ip", "x-forwarded-for": "203.0.113.7" }))).status, 503);
  assert.equal(handler.calls.length, 0);
});

test("limiter failure or denial cannot create an account", async () => {
  for (const rate of [{ data: false, error: null }, { data: null, error: null }, { data: true, error: { message: "private database detail" } }]) {
    const handler = registrationHandler({ rate });
    const response = await handler.post(registrationRequest());
    assert.equal(response.status, rate.error ? 503 : 429);
    if (!rate.error) assert.equal(response.headers.get("retry-after"), "3600");
    assert.equal(handler.calls.some((call) => call.method === "createUser"), false);
    assert.doesNotMatch(await response.text(), /private database/);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("duplicate/weak-password and transient registration errors have safe distinct responses", async () => {
  for (const [code, status] of [["email_exists", 409], ["user_already_exists", 409], ["weak_password", 400], ["email_address_invalid", 400], ["unexpected_failure", 503]] as const) {
    const handler = registrationHandler({ result: { error: { code, status: 422, message: "private backend detail" } } });
    const response = await handler.post(registrationRequest());
    assert.equal(response.status, status);
    assert.doesNotMatch(await response.text(), /private backend/);
  }
  const thrown = registrationHandler({ throws: true });
  assert.equal((await thrown.post(registrationRequest())).status, 503);
  const empty = registrationHandler({ result: { data: { user: null }, error: null } });
  assert.equal((await empty.post(registrationRequest())).status, 503);
});

test("private browser pages redirect while private APIs return JSON 401", async () => {
  const handler = middlewareHandler();
  const page = await handler.run("/workout/fixture?tab=sets", { cookie: "user_id=owner", "x-ritm-account-id": "owner" });
  assert.equal(page.status, 307);
  const target = new URL(page.headers.get("location")!);
  assert.equal(target.pathname, "/login");
  assert.equal(target.searchParams.get("next"), "/workout/fixture?tab=sets");
  const api = await handler.run("/api/sync");
  assert.equal(api.status, 401);
  assert.equal(api.headers.get("location"), null);
  assert.deepEqual(await api.json(), { error: "unauthorized" });
});

test("each server-verified registered account is permitted, never an anonymous identity", async () => {
  for (const id of ["fixture-account-a", "fixture-account-b"]) {
    const response = await middlewareHandler({ user: { id, email: `${id}@example.test` }, env: { ...configured, RITM_OWNER_USER_ID: "different-owner" } }).run("/today", { "x-ritm-account-id": "forged-account" });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-ritm-account-id"), id);
    assert.match(response.headers.get("cache-control")!, /no-store/);
  }
  for (const user of [{ id: "anonymous", is_anonymous: true, email: "anonymous@example.test" }, { id: "unregistered" }]) assert.equal((await middlewareHandler({ user }).run("/api/sync")).status, 401);
});

test("auth configuration is fail-closed, including explicit demo mode on Vercel", async () => {
  for (const env of [{}, { VERCEL: "1", RITM_DEMO_MODE: "1" }]) {
    const handler = middlewareHandler({ env });
    assert.equal((await handler.run("/today")).status, 307);
    assert.equal((await handler.run("/api/sync")).status, 503);
    assert.equal(handler.verified(), 0);
  }
  assert.equal((await middlewareHandler({ env: { RITM_DEMO_MODE: "1" } }).run("/today")).headers.get("x-middleware-next"), "1");
});

test("only specifically protected service endpoints bypass browser authentication", async () => {
  const handler = middlewareHandler({ env: {} });
  for (const path of ["/api/telegram/webhook", "/api/telegram/worker", "/api/auth/register"]) assert.equal((await handler.run(path)).headers.get("x-middleware-next"), "1");
  for (const path of ["/api/telegram/link", "/api/workout/command", "/api/telegram/webhook/not-public"]) assert.equal((await handler.run(path)).status, 503);
  assert.equal(handler.verified(), 0);
});

test("refresh cookies survive redirects and JSON failures across multiple setAll calls", async () => {
  const handler = middlewareHandler({ refresh: true });
  for (const path of ["/today", "/api/sync"]) {
    const response = await handler.run(path);
    assert.equal(response.cookies.get("sb-fixture-refresh")?.value, "renewed");
    assert.equal(response.cookies.get("sb-fixture-refresh")?.httpOnly, true);
    assert.equal(response.cookies.get("sb-fixture-access")?.value, "verified");
  }
  const signed = await middlewareHandler({ user: { id: "fixture", email: "fixture@example.test" }, refresh: true }).run("/login?next=//evil.test");
  assert.equal(signed.headers.get("location"), `${origin}/today`);
  assert.equal(signed.cookies.get("sb-fixture-refresh")?.value, "renewed");
});

test("auth outages never open private pages, leak internals, or strand the public login in a loop", async () => {
  for (const options of [{ throws: true }, { constructorThrows: true }, { error: { status: 503 }, user: { id: "fixture", email: "fixture@example.test" } }]) {
    const handler = middlewareHandler(options);
    const page = await handler.run("/today");
    assert.equal(page.status, 307);
    assert.equal(new URL(page.headers.get("location")!).searchParams.get("reason"), "unavailable");
    const api = await handler.run("/api/sync");
    assert.equal(api.status, 503);
    assert.doesNotMatch(await api.text(), /private|connection detail|config detail/);
    for (const path of ["/login", "/register", "/update-password"]) assert.equal((await handler.run(path)).headers.get("x-middleware-next"), "1");
  }
});
