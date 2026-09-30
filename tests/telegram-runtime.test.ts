import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as telegram from "../src/lib/telegram.ts";

const require = createRequire(import.meta.url);
const { NextRequest, NextResponse } = require("next/server") as typeof import("next/server");
const origin = "https://ritm.test";
const secret = "fixture-telegram-secret";
const configured = {
  NEXT_PUBLIC_SUPABASE_URL: "https://fixture.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key",
  TELEGRAM_BOT_TOKEN: "fixture-bot-token",
  TELEGRAM_WEBHOOK_SECRET: secret,
};
const job = {
  id: "11111111-1111-4111-8111-111111111111",
  user_id: "fixture-account",
  telegram_user_id: 101,
  source_entity_id: "workout-session:fixture-set",
  source_version: 2,
  attempts: 1,
  message: "Fixture rest finished",
  lease_token: "fixture-job-lease",
};
type DbResult = { data: unknown; error: unknown };
type RpcCall = { kind: "rpc"; name: string; args: Record<string, unknown> };
type QueryCall = {
  kind: "query";
  table: string;
  operation: "select" | "update";
  columns?: string;
  values?: Record<string, unknown>;
  steps: Array<[string, ...unknown[]]>;
};
type FetchCall = { kind: "fetch"; url: string; init?: RequestInit; body: Record<string, unknown> };
type Event = RpcCall | QueryCall | FetchCall;
type ClientOptions = { auth: { autoRefreshToken: boolean; persistSession: boolean }; global: { fetch: typeof fetch } };
type FixtureOptions = {
  env?: Record<string, string | undefined>;
  jobs?: typeof job[];
  rpc?: (call: RpcCall) => DbResult | Promise<DbResult>;
  query?: (call: QueryCall) => DbResult | Promise<DbResult>;
  fetch?: (call: FetchCall) => Response | Promise<Response>;
  expireTimeout?: number;
};
type Handler = { POST: (request: InstanceType<typeof NextRequest>) => Promise<InstanceType<typeof NextResponse>> };
const ok = (data: unknown): DbResult => ({ data, error: null });
const unavailable: DbResult = { data: null, error: { message: "fixture private database detail" } };

function defaultRpc(call: RpcCall, jobs: typeof job[] = []): DbResult {
  switch (call.name) {
    case "claim_notification_jobs": return ok(jobs.slice(0, Number(call.args.p_limit)));
    case "claim_telegram_update": return ok({ status: "claimed", processing_token: "fixture-update-lease" });
    case "confirm_telegram_link": return ok(false);
    case "accept_telegram_habit_command":
    case "accept_telegram_timer_command": return ok({ status: "applied" });
    case "refresh_habit_notifications":
    case "finish_notification_job":
    case "finish_telegram_update": return ok(true);
    default: assert.fail(`Unexpected RPC: ${call.name}`);
  }
}

function defaultQuery(call: QueryCall): DbResult {
  switch (call.table) {
    case "telegram_updates": return ok([]);
    case "telegram_links": return ok(null);
    case "notification_jobs": return ok({ source_entity_id: job.source_entity_id, source_version: job.source_version, user_id: job.user_id });
    default: assert.fail(`Unexpected table: ${call.table}`);
  }
}

// Execute the real CommonJS-transpiled handlers; every database and network entry point is injected.
function fixture(options: FixtureOptions = {}) {
  const events: Event[] = [];
  const clients: Array<{ url: string; key: string; options: ClientOptions }> = [];
  const timeouts: number[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const call: FetchCall = { kind: "fetch", url, init, body: JSON.parse(String(init?.body ?? "{}")) };
    events.push(call);
    return options.fetch ? options.fetch(call) : Response.json({ ok: true });
  };
  const abortSignals = {
    timeout(milliseconds: number) {
      timeouts.push(milliseconds);
      return milliseconds === options.expireTimeout
        ? AbortSignal.abort(new DOMException("Fixture deadline elapsed", "TimeoutError"))
        : AbortSignal.timeout(milliseconds);
    },
    any: (signals: AbortSignal[]) => AbortSignal.any(signals),
  };
  const admin = {
    async rpc(name: string, args: Record<string, unknown> = {}) {
      const call: RpcCall = { kind: "rpc", name, args: structuredClone(args) };
      events.push(call);
      return options.rpc ? options.rpc(call) : defaultRpc(call, options.jobs);
    },
    from(table: string) {
      const call: QueryCall = { kind: "query", table, operation: "select", steps: [] };
      let result: Promise<DbResult> | undefined;
      const execute = () => {
        if (!result) {
          events.push(call);
          result = Promise.resolve(options.query ? options.query(call) : defaultQuery(call));
        }
        return result;
      };
      const query = {
        select(columns: string) { call.columns = columns; return query; },
        update(values: Record<string, unknown>) { call.operation = "update"; call.values = structuredClone(values); return query; },
        eq(column: string, value: unknown) { call.steps.push(["eq", column, value]); return query; },
        is(column: string, value: unknown) { call.steps.push(["is", column, value]); return query; },
        or(value: string) { call.steps.push(["or", value]); return query; },
        lt(column: string, value: unknown) { call.steps.push(["lt", column, value]); return query; },
        order(column: string) { call.steps.push(["order", column]); return query; },
        limit(value: number) { call.steps.push(["limit", value]); return query; },
        maybeSingle() { call.steps.push(["maybeSingle"]); return execute(); },
        then(resolve: (value: DbResult) => unknown, reject: (reason: unknown) => unknown) { return execute().then(resolve, reject); },
      };
      return query;
    },
  };
  function load(path: string, replacements: Record<string, unknown>): unknown {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    const cjsModule = { exports: {} };
    vm.runInNewContext(compiled, {
      module: cjsModule, exports: cjsModule.exports,
      require(name: string) {
        if (Object.hasOwn(replacements, name)) return replacements[name];
        assert.equal(name, "next/server", `Unexpected uninjected dependency: ${name}`);
        return require(name);
      },
      process: { env: options.env ?? configured },
      URL, Request, Response, Error, AbortSignal: abortSignals, fetch: fakeFetch,
    }, { filename: path });
    return cjsModule.exports;
  }
  const serverFetch = load("../src/lib/server-fetch.ts", {}) as { boundedServerFetch: typeof fetch };
  const replacements = {
    "@/lib/telegram": telegram,
    "@/lib/server-fetch": serverFetch,
    "@supabase/supabase-js": {
      createClient(url: string, key: string, clientOptions: ClientOptions) { clients.push({ url, key, options: clientOptions }); return admin; },
    },
  };
  const webhook = load("../src/app/api/telegram/webhook/route.ts", replacements) as Handler;
  const worker = load("../src/app/api/telegram/worker/route.ts", { ...replacements, "../webhook/route": webhook }) as Handler;
  return {
    events, clients, timeouts,
    worker: (header: string | null = secret) => worker.POST(new NextRequest(`${origin}/api/telegram/worker`, {
      method: "POST", headers: header === null ? {} : { "x-telegram-worker-secret": header },
    })),
    webhook: (update: unknown, header: string | null = secret) => webhook.POST(new NextRequest(`${origin}/api/telegram/webhook`, {
      method: "POST", headers: { "content-type": "application/json", ...(header === null ? {} : { "x-telegram-bot-api-secret-token": header }) }, body: JSON.stringify(update),
    })),
  };
}

function rpcs(events: Event[], name: string): RpcCall[] {
  return events.filter((event): event is RpcCall => event.kind === "rpc" && event.name === name);
}
function queries(events: Event[], table: string): QueryCall[] {
  return events.filter((event): event is QueryCall => event.kind === "query" && event.table === table);
}
function sends(events: Event[]): FetchCall[] {
  return events.filter((event): event is FetchCall => event.kind === "fetch");
}
function start(updateId = 700, sender = 101, token = "fixture-link-token") {
  return { update_id: updateId, message: { from: { id: sender }, chat: { id: sender }, text: `/start ${token}` } };
}
function callback(kind: "habit" | "timer", updateId = 800) {
  return { update_id: updateId, callback_query: { id: "fixture-callback", from: { id: 101 }, message: { chat: { id: 101 } }, data: `${kind === "habit" ? "habit_done" : "rest_add30"}:${job.id}:${job.source_version}` } };
}
function assertRetry(value: unknown, before: number, seconds: number) {
  assert.equal(typeof value, "string");
  const timestamp = Date.parse(value as string);
  assert.ok(timestamp >= before + seconds * 1000 && timestamp <= Date.now() + seconds * 1000, `Invalid retry deadline: ${value}`);
}

for (const handler of ["worker", "webhook"] as const) {
  test(`Telegram ${handler} rejects invalid or unconfigured secrets before database work or sends`, async () => {
    for (const header of [null, "", "wrong-secret", `${secret}x`]) {
      const runtime = fixture();
      const response = handler === "worker" ? await runtime.worker(header) : await runtime.webhook(start(), header);
      assert.ok(response instanceof NextResponse);
      assert.equal(response.status, 401);
      assert.deepEqual(runtime.clients, []);
      assert.deepEqual(runtime.events, []);
    }
    const runtime = fixture({ env: { ...configured, TELEGRAM_WEBHOOK_SECRET: undefined } });
    assert.equal((handler === "worker" ? await runtime.worker() : await runtime.webhook(start())).status, 401);
    assert.deepEqual(runtime.events, []);
    assert.deepEqual(runtime.clients, []);
  });

  test(`Telegram ${handler} fails closed for missing service configuration`, async () => {
    for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "TELEGRAM_BOT_TOKEN"]) {
      const runtime = fixture({ env: { ...configured, [name]: undefined } });
      assert.equal((handler === "worker" ? await runtime.worker() : await runtime.webhook(start())).status, 503);
      assert.deepEqual(runtime.events, []);
      assert.deepEqual(runtime.clients, []);
    }
  });
}

test("Telegram clients install the actual three-second bounded fetch and preserve caller cancellation", async () => {
  for (const handler of ["worker", "webhook"] as const) {
    const runtime = fixture({ expireTimeout: 3000, fetch: async (call) => {
      assert.ok(call.init?.signal?.aborted);
      throw call.init.signal.reason;
    } });
    await (handler === "worker" ? runtime.worker() : runtime.webhook({ update_id: 1 }));
    const client = runtime.clients[0];
    assert.equal(client.url, configured.NEXT_PUBLIC_SUPABASE_URL);
    assert.equal(client.key, configured.SUPABASE_SERVICE_ROLE_KEY);
    assert.deepEqual(structuredClone(client.options.auth), { autoRefreshToken: false, persistSession: false });
    await assert.rejects(client.options.global.fetch(`${configured.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/fixture`), { name: "TimeoutError" });
    assert.deepEqual(runtime.timeouts, [3000]);
  }
  const runtime = fixture({ fetch: async (call) => {
    assert.ok(call.init?.signal?.aborted);
    throw call.init.signal.reason;
  } });
  await runtime.worker();
  const fetcher = runtime.clients[0].options.global.fetch;
  const reason = new Error("fixture caller cancelled");
  await assert.rejects(fetcher(configured.NEXT_PUBLIC_SUPABASE_URL, { signal: AbortSignal.abort(reason) }), (error) => error === reason);
  await assert.rejects(fetcher(new Request(configured.NEXT_PUBLIC_SUPABASE_URL, { signal: AbortSignal.abort(reason) })), (error) => error === reason);
  assert.deepEqual(runtime.timeouts, [3000, 3000]);
});

test("Telegram worker bounds durable replays and notification claims to one each", async () => {
  const queued = Array.from({ length: 10 }, (_, index) => ({ ...job, id: `fixture-job-${index}` }));
  const updates = Array.from({ length: 10 }, (_, index) => ({ update_id: index, payload: { update_id: index } }));
  const runtime = fixture({ jobs: queued, query: (call) => {
    if (call.table !== "telegram_updates") return defaultQuery(call);
    assert.deepEqual(call.steps.filter(([method]) => method === "limit"), [["limit", 1]]);
    assert.deepEqual(call.steps.filter(([method]) => method === "lt" || method === "order"), [["lt", "attempts", 5], ["order", "update_id"]]);
    assert.match(String(call.steps.find(([method]) => method === "or")?.[1]), /^status\.eq\.failed,and\(status\.eq\.processing,lease_until\.lt\./);
    return ok(updates.slice(0, Number(call.steps.find(([method]) => method === "limit")?.[1])));
  } });
  const response = await runtime.worker();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { processed: 1, results: [{ id: queued[0].id, status: "sent" }] });
  assert.equal(runtime.clients.length, 2, "The worker must run the real webhook for a durable replay");
  assert.equal(rpcs(runtime.events, "claim_telegram_update").length, 1);
  assert.deepEqual(rpcs(runtime.events, "claim_telegram_update")[0].args, { p_update_id: 0, p_payload: { update_id: 0 } });
  assert.deepEqual(rpcs(runtime.events, "claim_notification_jobs")[0].args, { p_limit: 1, p_lease_seconds: 45 });
  assert.ok(runtime.events.indexOf(rpcs(runtime.events, "finish_telegram_update")[0]) < runtime.events.indexOf(rpcs(runtime.events, "refresh_habit_notifications")[0]));
  assert.equal(sends(runtime.events).length, 1);
});

test("Telegram worker with an empty queue does not send or finish any notification", async () => {
  const runtime = fixture();
  const response = await runtime.worker();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { processed: 0, results: [] });
  assert.equal(sends(runtime.events).length, 0);
  assert.equal(rpcs(runtime.events, "finish_notification_job").length, 0);
});

test("Telegram worker queue errors return 503 before sending", async () => {
  for (const failing of ["telegram_updates", "refresh_habit_notifications", "claim_notification_jobs"]) {
    const runtime = fixture({ jobs: [job], query: (call) => call.table === failing ? unavailable : defaultQuery(call), rpc: (call) => call.name === failing ? unavailable : defaultRpc(call, [job]) });
    const response = await runtime.worker();
    assert.equal(response.status, 503);
    assert.equal(sends(runtime.events).length, 0);
    assert.equal(rpcs(runtime.events, "finish_notification_job").length, 0);
    assert.doesNotMatch(await response.text(), /private database detail/);
  }
});

test("Telegram worker success sends the claimed job with versioned buttons and fences completion", async () => {
  const runtime = fixture({ jobs: [job] });
  const response = await runtime.worker();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { processed: 1, results: [{ id: job.id, status: "sent" }] });
  const send = sends(runtime.events)[0];
  assert.equal(send.url, `https://api.telegram.org/bot${configured.TELEGRAM_BOT_TOKEN}/sendMessage`);
  assert.equal(send.init?.method, "POST");
  assert.equal((send.init?.headers as Record<string, string>)["content-type"], "application/json");
  assert.ok(send.init?.signal instanceof AbortSignal);
  assert.deepEqual(send.body, { chat_id: job.telegram_user_id, text: job.message, reply_markup: { inline_keyboard: [[
    { text: "+30 сек", callback_data: `rest_add30:${job.id}:${job.source_version}` },
    { text: "Пропустить", callback_data: `rest_skip:${job.id}:${job.source_version}` },
  ]] } });
  assert.deepEqual(runtime.timeouts, [8000]);
  assert.deepEqual(rpcs(runtime.events, "finish_notification_job")[0].args, { p_job_id: job.id, p_lease_token: job.lease_token, p_status: "sent", p_error: null, p_next_attempt_at: null });
  assert.ok(runtime.events.indexOf(send) < runtime.events.indexOf(rpcs(runtime.events, "finish_notification_job")[0]));
});

test("Telegram worker habit and diagnostic jobs use the correct message controls", async () => {
  for (const source of ["habit:fixture-habit:2026-09-30:1", "telegram-diagnostic:fixture"]) {
    const runtime = fixture({ jobs: [{ ...job, source_entity_id: source }] });
    assert.equal((await runtime.worker()).status, 200);
    const body = sends(runtime.events)[0].body;
    if (source.startsWith("habit:")) {
      const buttons = (body.reply_markup as { inline_keyboard: Array<Array<{ callback_data: string }>> }).inline_keyboard.flat();
      assert.deepEqual(buttons.map((button) => button.callback_data), ["done", "skip", "later"].map((action) => `habit_${action}:${job.id}:${job.source_version}`));
      assert.ok(buttons.every((button) => Buffer.byteLength(button.callback_data) <= 64));
    } else assert.equal(Object.hasOwn(body, "reply_markup"), false);
  }
});

test("Telegram worker respects 429 retry_after without marking delivery successful", async () => {
  const runtime = fixture({ jobs: [job], fetch: () => Response.json({ ok: false, description: "Too Many Requests", parameters: { retry_after: 37 } }, { status: 429 }) });
  const before = Date.now();
  const response = await runtime.worker();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { processed: 1, results: [{ id: job.id, status: "failed" }] });
  const finish = rpcs(runtime.events, "finish_notification_job")[0].args;
  assert.equal(finish.p_status, "failed");
  assert.equal(finish.p_error, "Too Many Requests");
  assertRetry(finish.p_next_attempt_at, before, 37);
  assert.equal(queries(runtime.events, "telegram_links").length, 0);
  assert.equal(sends(runtime.events).length, 1);
});

test("Telegram worker cancels permanent 400/403 failures and scopes the delivery error to the claimed account", async () => {
  for (const status of [400, 403]) {
    const description = `fixture permanent error ${status}`;
    const runtime = fixture({ jobs: [job], fetch: () => Response.json({ ok: false, description }, { status }) });
    const response = await runtime.worker();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { processed: 1, results: [{ id: job.id, status: "cancelled" }] });
    const link = queries(runtime.events, "telegram_links")[0];
    assert.equal(link.operation, "update");
    assert.equal(link.values?.delivery_status, "error");
    assert.equal(link.values?.last_delivery_error, description);
    assert.ok(Number.isFinite(Date.parse(String(link.values?.last_delivery_error_at))));
    assert.deepEqual(link.steps, [["eq", "user_id", job.user_id]]);
    const finish = rpcs(runtime.events, "finish_notification_job")[0];
    assert.equal(finish.args.p_status, "cancelled");
    assert.equal(finish.args.p_next_attempt_at, null);
    assert.ok(runtime.events.indexOf(link) < runtime.events.indexOf(finish));
  }
});

test("Telegram worker timeout records an unknown outcome with a bounded retry, never sent", async () => {
  const runtime = fixture({ jobs: [job], expireTimeout: 8000, fetch: async (call) => {
    assert.equal(call.init?.signal?.aborted, true);
    throw call.init?.signal?.reason;
  } });
  const before = Date.now();
  const response = await runtime.worker();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { processed: 1, results: [{ id: job.id, status: "unknown" }] });
  const finish = rpcs(runtime.events, "finish_notification_job")[0].args;
  assert.equal(finish.p_status, "unknown");
  assert.equal(finish.p_lease_token, job.lease_token);
  assert.equal(finish.p_error, "Fixture deadline elapsed");
  assertRetry(finish.p_next_attempt_at, before, 60);
  assert.deepEqual(runtime.timeouts, [8000]);
  assert.equal(queries(runtime.events, "telegram_links").length, 0);
});

test("Telegram worker transient or malformed API responses never claim success and stop retrying after three attempts", async () => {
  for (const attempts of [1, 3]) {
    for (const response of [() => Response.json({ ok: false }, { status: 500 }), () => new Response("invalid JSON", { status: 200 }), () => Response.json({ ok: false }, { status: 200 })]) {
      const runtime = fixture({ jobs: [{ ...job, attempts }], fetch: response });
      const result = await runtime.worker();
      assert.equal(result.status, 200);
      assert.deepEqual(await result.json(), { processed: 1, results: [{ id: job.id, status: attempts >= 3 ? "unknown" : "failed" }] });
      assert.equal(rpcs(runtime.events, "finish_notification_job")[0].args.p_next_attempt_at, null);
      assert.equal(queries(runtime.events, "telegram_links").length, 0);
    }
  }
});

const deliveryCases: Array<{ name: string; fetch: NonNullable<FixtureOptions["fetch"]> }> = [
  { name: "success", fetch: () => Response.json({ ok: true }) },
  { name: "429", fetch: () => Response.json({ ok: false, parameters: { retry_after: 1 } }, { status: 429 }) },
  { name: "permanent error", fetch: () => Response.json({ ok: false }, { status: 403 }) },
  { name: "uncertain timeout", fetch: async () => { throw new DOMException("Fixture timeout", "TimeoutError"); } },
];
for (const delivery of deliveryCases) {
  test(`Telegram worker returns 503 when persisting the ${delivery.name} outcome fails`, async () => {
    const runtime = fixture({ jobs: [job], fetch: delivery.fetch, rpc: (call) => call.name === "finish_notification_job" ? unavailable : defaultRpc(call, [job]) });
    const response = await runtime.worker();
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "queue_unavailable" });
    assert.equal(sends(runtime.events).length, 1);
    assert.equal(rpcs(runtime.events, "finish_notification_job").length, 1);
  });
}

test("Telegram worker reports lease_lost rather than claiming any unfenced outcome", async () => {
  for (const delivery of deliveryCases) {
    const runtime = fixture({ jobs: [job], fetch: delivery.fetch, rpc: (call) => call.name === "finish_notification_job" ? ok(false) : defaultRpc(call, [job]) });
    const response = await runtime.worker();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { processed: 1, results: [{ id: job.id, status: "lease_lost" }] });
    assert.equal(rpcs(runtime.events, "finish_notification_job")[0].args.p_lease_token, job.lease_token);
  }
});

test("Telegram webhook rejects malformed updates before opening a database client", async () => {
  for (const update of [null, [], {}, { update_id: -1 }, { update_id: 1.5 }, { update_id: Number.MAX_SAFE_INTEGER + 1 }]) {
    const runtime = fixture();
    assert.equal((await runtime.webhook(update)).status, 400);
    assert.deepEqual(runtime.clients, []);
    assert.deepEqual(runtime.events, []);
  }
});

test("Telegram webhook writes the durable receipt before linking, acknowledgement, or completion", async () => {
  const update = start();
  const runtime = fixture({ rpc: (call) => call.name === "confirm_telegram_link" ? ok(true) : defaultRpc(call) });
  const response = await runtime.webhook(update);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { accepted: true, linked: true, confirmation: "sent" });
  assert.deepEqual(runtime.events.map((event) => event.kind === "rpc" ? event.name : event.kind), ["claim_telegram_update", "confirm_telegram_link", "fetch", "finish_telegram_update"]);
  assert.deepEqual(rpcs(runtime.events, "claim_telegram_update")[0].args, { p_update_id: update.update_id, p_payload: update });
  assert.deepEqual(rpcs(runtime.events, "confirm_telegram_link")[0].args, { p_token_hash: telegram.hashTelegramLinkToken("fixture-link-token"), p_telegram_user_id: 101 });
  assert.deepEqual(rpcs(runtime.events, "finish_telegram_update")[0].args, { p_update_id: update.update_id, p_processing_token: "fixture-update-lease", p_status: "processed", p_error: null });
  assert.equal(sends(runtime.events)[0].body.chat_id, 101);
  assert.deepEqual(runtime.timeouts, [8000]);
});

test("Telegram webhook cannot act or send when durable receipt claiming fails", async () => {
  for (const result of [unavailable, ok(null), ok({ status: "claimed" })]) {
    const runtime = fixture({ rpc: (call) => call.name === "claim_telegram_update" ? result : defaultRpc(call) });
    const response = await runtime.webhook(start());
    assert.equal(response.status, 503);
    assert.deepEqual(runtime.events.map((event) => event.kind === "rpc" ? event.name : event.kind), ["claim_telegram_update"]);
    assert.equal(sends(runtime.events).length, 0);
  }
});

test("Telegram webhook processed or busy duplicates do not repeat commands or sends", async () => {
  for (const status of ["processed", "busy"]) {
    const runtime = fixture({ rpc: (call) => call.name === "claim_telegram_update" ? ok({ status }) : defaultRpc(call) });
    const response = await runtime.webhook(callback("habit"));
    assert.equal(response.status, status === "busy" ? 202 : 200);
    assert.deepEqual(await response.json(), { accepted: true, updateId: 800, [status === "busy" ? "busy" : "duplicate"]: true });
    assert.equal(runtime.events.length, 1);
    assert.equal(sends(runtime.events).length, 0);
  }
});

test("Telegram /start replay resolves a consumed token only from the same sender's confirmed durable link", async () => {
  let consumed = false;
  let processed = false;
  let finishes = 0;
  let claims = 0;
  const runtime = fixture({ rpc: (call) => {
    if (call.name === "claim_telegram_update") return ok(processed ? { status: "processed" } : { status: "claimed", processing_token: `fixture-update-lease-${++claims}` });
    if (call.name === "confirm_telegram_link") {
      if (consumed) return ok(false);
      consumed = true;
      return ok(true);
    }
    if (call.name === "finish_telegram_update") {
      if (++finishes === 1) return unavailable;
      processed = true;
      return ok(true);
    }
    return defaultRpc(call);
  }, query: (call) => {
    assert.equal(consumed, true);
    assert.equal(call.table, "telegram_links");
    assert.equal(call.columns, "confirmed_at");
    assert.deepEqual(call.steps, [["eq", "token_hash", telegram.hashTelegramLinkToken("fixture-link-token")], ["eq", "telegram_user_id", 101], ["is", "revoked_at", null], ["maybeSingle"]]);
    return ok({ confirmed_at: "2026-09-30T10:00:00.000Z" });
  } });
  assert.equal((await runtime.webhook(start())).status, 503);
  assert.equal(consumed, true);
  const replay = await runtime.webhook(start());
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), { accepted: true, linked: true, confirmation: "sent" });
  const duplicate = await runtime.webhook(start());
  assert.deepEqual(await duplicate.json(), { accepted: true, updateId: 700, duplicate: true });
  assert.equal(queries(runtime.events, "telegram_links").length, 1);
  assert.equal(sends(runtime.events).length, 2);
  assert.ok(sends(runtime.events).every((send) => send.body.text === "Telegram подключен к Ритму."));
  assert.deepEqual(rpcs(runtime.events, "finish_telegram_update").map((call) => call.args.p_processing_token), ["fixture-update-lease-1", "fixture-update-lease-2"]);
});

test("Telegram /start cannot reuse a consumed token for a different sender, token, revoked or unconfirmed link", async () => {
  const hash = telegram.hashTelegramLinkToken("fixture-link-token");
  for (const attempt of [
    { sender: 202, token: "fixture-link-token", revoked: false, confirmed: true },
    { sender: 101, token: "different-token", revoked: false, confirmed: true },
    { sender: 101, token: "fixture-link-token", revoked: true, confirmed: true },
    { sender: 101, token: "fixture-link-token", revoked: false, confirmed: false },
  ]) {
    const runtime = fixture({ query: (call) => {
      assert.equal(call.table, "telegram_links");
      assert.equal(call.columns, "confirmed_at");
      assert.ok(call.steps.some((step) => step[0] === "is" && step[1] === "revoked_at" && step[2] === null));
      const matches = call.steps.some((step) => step[0] === "eq" && step[1] === "token_hash" && step[2] === hash)
        && call.steps.some((step) => step[0] === "eq" && step[1] === "telegram_user_id" && step[2] === 101)
        && !attempt.revoked;
      return ok(matches ? { confirmed_at: attempt.confirmed ? "2026-09-30T10:00:00.000Z" : null } : null);
    } });
    const response = await runtime.webhook(start(701, attempt.sender, attempt.token));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true, linked: false, confirmation: "sent" });
    assert.equal(sends(runtime.events)[0].body.chat_id, attempt.sender);
    assert.doesNotMatch(String(sends(runtime.events)[0].body.text), /Telegram подключен/);
  }
});

test("Telegram /start rejects sender/chat mismatches before token confirmation or any send", async () => {
  for (const sender of [undefined, 202, -101, 0]) {
    const runtime = fixture();
    const response = await runtime.webhook({ update_id: 702, message: { from: sender === undefined ? undefined : { id: sender }, chat: { id: 101 }, text: "/start fixture-link-token" } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true, linked: false });
    assert.equal(rpcs(runtime.events, "confirm_telegram_link").length, 0);
    assert.equal(queries(runtime.events, "telegram_links").length, 0);
    assert.equal(sends(runtime.events).length, 0);
    assert.equal(rpcs(runtime.events, "finish_telegram_update")[0].args.p_status, "processed");
  }
});

test("Telegram /start storage failures remain durable, return 503, and send no confirmation", async () => {
  for (const failure of ["confirm_telegram_link", "telegram_links"]) {
    const runtime = fixture({ rpc: (call) => call.name === failure ? unavailable : defaultRpc(call), query: (call) => call.table === failure ? unavailable : defaultQuery(call) });
    const response = await runtime.webhook(start());
    assert.equal(response.status, 503);
    assert.equal(rpcs(runtime.events, "finish_telegram_update")[0].args.p_status, "failed");
    assert.equal(sends(runtime.events).length, 0);
    assert.doesNotMatch(await response.text(), /private database detail/);
  }
});

test("Telegram /start acknowledgement timeouts do not erase a confirmed durable link", async () => {
  const runtime = fixture({ rpc: (call) => call.name === "confirm_telegram_link" ? ok(true) : defaultRpc(call), expireTimeout: 8000, fetch: async (call) => { throw call.init?.signal?.reason; } });
  const response = await runtime.webhook(start());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { accepted: true, linked: true, confirmation: "unknown" });
  assert.equal(rpcs(runtime.events, "finish_telegram_update")[0].args.p_status, "processed");
  assert.deepEqual(runtime.timeouts, [8000]);
});

for (const kind of ["habit", "timer"] as const) {
  test(`Telegram ${kind} callback replay acknowledges the actual duplicate RPC status with a stable command key`, async () => {
    const commandRpc = `accept_telegram_${kind === "habit" ? "habit" : "timer"}_command`;
    let commands = 0;
    let finishes = 0;
    const runtime = fixture({ rpc: (call) => {
      if (call.name === commandRpc) return ok({ status: ++commands === 1 ? "applied" : "duplicate" });
      if (call.name === "finish_telegram_update") return ok(++finishes > 1);
      return defaultRpc(call);
    } });
    assert.equal((await runtime.webhook(callback(kind))).status, 503);
    const replay = await runtime.webhook(callback(kind));
    assert.equal(replay.status, 200);
    const body = await replay.json();
    assert.equal(body.accepted, true);
    assert.equal(body.callback, "duplicate");
    assert.equal(body.acknowledgement, "sent");
    const accepted = rpcs(runtime.events, commandRpc);
    assert.equal(accepted.length, 2);
    assert.deepEqual(accepted[0].args, accepted[1].args);
    assert.equal(accepted[0].args.p_command_key, "telegram-callback-800");
    assert.equal(accepted[0].args.p_telegram_user_id, 101);
    assert.equal(accepted[0].args.p_source_version, job.source_version);
    assert.equal(accepted[0].args[kind === "habit" ? "p_job_id" : "p_entity_id"], kind === "habit" ? job.id : job.source_entity_id);
    const acknowledgements = sends(runtime.events);
    assert.equal(acknowledgements.length, 2);
    assert.ok(acknowledgements.every((call) => call.url.endsWith("/answerCallbackQuery") && call.body.callback_query_id === "fixture-callback"));
    assert.ok(acknowledgements.every((call) => call.body.text === (kind === "habit" ? "Отмечено" : "Отдых продлен на 30 секунд")));
    assert.ok(runtime.events.indexOf(accepted[0]) < runtime.events.indexOf(acknowledgements[0]));
    assert.equal(runtime.events[0], rpcs(runtime.events, "claim_telegram_update")[0]);
    assert.deepEqual(runtime.timeouts, [8000, 8000]);
    if (kind === "timer") {
      assert.deepEqual(queries(runtime.events, "notification_jobs")[0].steps, [["eq", "id", job.id], ["eq", "source_version", job.source_version], ["maybeSingle"]]);
    }
  });

  test(`Telegram ${kind} callback RPC failures return 503 without sending a success acknowledgement`, async () => {
    const runtime = fixture({ rpc: (call) => call.name === `accept_telegram_${kind === "habit" ? "habit" : "timer"}_command` ? unavailable : defaultRpc(call) });
    assert.equal((await runtime.webhook(callback(kind))).status, 503);
    assert.equal(sends(runtime.events).length, 0);
    assert.equal(rpcs(runtime.events, "finish_telegram_update")[0].args.p_status, "failed");
  });
}

test("Telegram habit callbacks acknowledge the actual applied, duplicate, stale, unlinked and limited RPC status", async () => {
  for (const action of ["done", "skip", "later"]) {
    for (const status of ["applied", "duplicate", "stale", "unlinked", "limited"]) {
      const runtime = fixture({ rpc: (call) => call.name === "accept_telegram_habit_command" ? ok({ status }) : defaultRpc(call) });
      const update = callback("habit");
      update.callback_query.data = `habit_${action}:${job.id}:${job.source_version}`;
      const response = await runtime.webhook(update);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { accepted: true, callback: status, acknowledgement: "sent" });
      const text = status === "applied" || status === "duplicate"
        ? action === "done" ? "Отмечено" : action === "later" ? "Отложено на 10 минут" : "Пропущено"
        : status === "limited" ? "Достигнут лимит повторов" : "Действие устарело";
      assert.equal(sends(runtime.events)[0].body.text, text);
      assert.equal(rpcs(runtime.events, "accept_telegram_habit_command")[0].args.p_action, action);
    }
  }
});

test("Telegram invalid callbacks acknowledge expiration without accepting a command", async () => {
  for (const invalid of ["chat", "data", "version", "job"]) {
    const update = callback("timer");
    if (invalid === "chat") update.callback_query.message.chat.id = 202;
    if (invalid === "data") update.callback_query.data = "rest_add30:invalid:0";
    const runtime = fixture({ query: (call) => call.table === "notification_jobs" ? ok(invalid === "job" ? null : { ...job, source_version: 3 }) : defaultQuery(call) });
    const response = await runtime.webhook(update);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true, updateId: 800, callback: "invalid", acknowledgement: "sent" });
    assert.equal(rpcs(runtime.events, "accept_telegram_timer_command").length, 0);
    assert.equal(sends(runtime.events)[0].body.text, "Действие устарело");
  }
});

test("Telegram callback acknowledgement failures expose unknown while preserving the accepted command", async () => {
  for (const kind of ["habit", "timer"] as const) {
    const runtime = fixture({ expireTimeout: 8000, fetch: async (call) => { throw call.init?.signal?.reason; } });
    const response = await runtime.webhook(callback(kind));
    assert.equal(response.status, kind === "timer" ? 202 : 200);
    const body = await response.json();
    assert.equal(body.callback, "applied");
    assert.equal(body.acknowledgement, "unknown");
    assert.equal(rpcs(runtime.events, "finish_telegram_update")[0].args.p_status, "processed");
    assert.deepEqual(runtime.timeouts, [8000]);
  }
});

test("Telegram webhook lost leases and completion errors return 503 instead of reporting processed", async () => {
  for (const result of [ok(false), unavailable]) {
    for (const update of [{ update_id: 900 }, start(), callback("habit"), callback("timer")]) {
      const runtime = fixture({ rpc: (call) => call.name === "finish_telegram_update" ? result : defaultRpc(call) });
      const response = await runtime.webhook(update);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "storage_unavailable" });
      assert.equal(rpcs(runtime.events, "finish_telegram_update")[0].args.p_processing_token, "fixture-update-lease");
    }
  }
});
