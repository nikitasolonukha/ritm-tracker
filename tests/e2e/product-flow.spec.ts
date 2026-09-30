import { expect, test, type BrowserContext, type Locator, type Page, type Request, type Route } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { SessionTrackerState } from "../../src/lib/workout-session";
import type { BackupDocument } from "../../src/lib/backup";
import { syncFingerprint, type SyncWriteIntent } from "../../src/lib/sync";

const baseURL = process.env.PRODUCT_QA_URL ?? "http://localhost:3005";
const runId = (process.env.PRODUCT_QA_RUN_ID ?? "product-flow-v1").replace(/[^a-z0-9-]/gi, "-").toLowerCase();
const browserName = process.env.PRODUCT_QA_BROWSER === "webkit" ? "webkit" : "chromium";
const artifactDir = browserName === "webkit" ? "artifacts/product-qa-webkit" : "artifacts/product-qa";
const diagnosticDir = `.private/product-qa-diagnostics-${browserName}`;
const layoutDefects: string[] = [];
const accounts = ["primary", "secondary"].map((role) => ({
  email: `${runId}-${role}@ritm-qa.test`,
  password: "Local-QA-Only-7391!",
}));
type Account = (typeof accounts)[number];
type Identity = { id: string; accessToken: string; backendURL: string; publicKey: string; created: boolean };
type Snapshot = { payload: SessionTrackerState | null; version: number; legacyImportAllowed: boolean };
const legacyMarker = "QA PRIVATE LEGACY MARKER - never import into a different account";
const legacyRaw = JSON.stringify({ version: 1, habits: [], completions: [], workouts: [], workoutTemplates: [], workoutCommands: [], activeTimer: null, observations: [{ id: "qa-private-legacy-observation", date: "2025-01-01", energy: 5, sleep: 7, skin: "unknown", note: legacyMarker }], photos: [], outbox: [] });

test.use({ baseURL, browserName, channel: process.env.PRODUCT_QA_CHANNEL, serviceWorkers: "allow", viewport: { width: 390, height: 844 }, actionTimeout: 15_000, navigationTimeout: 30_000 });
test.setTimeout(600_000);

function localOnly(url: string) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname);
}

async function protectLocalContext(context: BrowserContext) {
  // This is a safety boundary, not an API mock: all allowed requests use the real local services.
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (/^https?:/.test(url) && !localOnly(url)) await route.abort("blockedbyclient");
    else await route.continue();
  });
}

async function authenticate(page: Page, account: Account): Promise<Identity> {
  await page.goto(`${baseURL}/login`);
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(account.email);
  await page.getByLabel("Пароль", { exact: true }).fill(account.password);
  const tokenResponse = page.waitForResponse((r) => new URL(r.url()).pathname === "/auth/v1/token");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  let token = await tokenResponse;
  let created = false;
  if (!token.ok()) {
    const failedLogin = await token.json();
    expect(failedLogin.code, "Only an absent QA account may cause registration").toBe("invalid_credentials");
    await page.getByRole("link", { name: "Создать аккаунт", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Создать аккаунт", exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "Email", exact: true }).fill(account.email);
    await page.getByLabel("Пароль", { exact: true }).fill(account.password);
    const registration = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/auth/register" && r.request().method() === "POST");
    const signIn = page.waitForResponse((r) => new URL(r.url()).pathname === "/auth/v1/token").catch(() => undefined);
    await page.getByRole("button", { name: "Создать аккаунт", exact: true }).click();
    const registered = await registration;
    if (registered.status() !== 201) {
      console.log(`REGISTRATION DEFECT: status=${registered.status()}, origin=${registered.request().headers().origin}, url=${registered.url()}, body=${await registered.text()}`);
      await page.screenshot({ path: `${diagnosticDir}/registration-blocked-390.png`, fullPage: true });
    }
    expect(registered.status(), "Registration must immediately create the account without an email link").toBe(201);
    const signed = await signIn;
    expect(signed, "Registration must establish a browser session").toBeTruthy();
    token = signed!;
    created = true;
  }
  expect(token.ok(), "Local Auth must return a real session").toBe(true);
  expect(localOnly(token.url()), "Never authenticate these fixtures against production").toBe(true);
  await expect(page).toHaveURL(/\/today(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "Сегодня", exact: true })).toBeVisible();
  // The redirect can invalidate Playwright's response body. Read the browser's persisted session, then verify it with real Auth.
  const chunks = (await page.context().cookies()).filter((cookie) => /^sb-.*-auth-token(?:\.\d+)?$/.test(cookie.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const encoded = chunks.map((chunk) => chunk.value).join("");
  expect(encoded, "A durable browser session cookie must exist after sign-in").toBeTruthy();
  const session = JSON.parse(encoded.startsWith("base64-") ? Buffer.from(encoded.slice(7), "base64url").toString("utf8") : decodeURIComponent(encoded));
  expect(session.access_token).toBeTruthy();
  const backendURL = new URL(token.url()).origin;
  const publicKey = token.request().headers().apikey;
  const auth = createClient(backendURL, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const verified = await auth.auth.getUser(session.access_token);
  expect(verified.error).toBeNull();
  expect(verified.data.user?.email).toBe(account.email);
  expect(verified.data.user?.email_confirmed_at, "No email confirmation action is required").toBeTruthy();
  return { id: verified.data.user!.id, accessToken: session.access_token, backendURL, publicKey, created };
}

function scopedClient(identity: Identity): SupabaseClient {
  return createClient(identity.backendURL, identity.publicKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${identity.accessToken}` } } });
}

function localAdminClient(identity: Identity): SupabaseClient {
  expect(localOnly(identity.backendURL), "Administrative QA reads are allowed only against the isolated local backend").toBe(true);
  const configuredURL = process.env.PRODUCT_QA_BACKEND_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  expect(Boolean(configuredURL), "Inject the local backend URL and service role key into the QA process, never commit them").toBe(true);
  expect(localOnly(configuredURL!)).toBe(true);
  expect(new URL(configuredURL!).origin).toBe(new URL(identity.backendURL).origin);
  const serviceKey = process.env.PRODUCT_QA_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  expect(Boolean(serviceKey), "A local service role key is required to verify durable queue rows; do not silently skip this assertion").toBe(true);
  return createClient(identity.backendURL, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function serverSnapshot(page: Page): Promise<Snapshot> {
  const response = await page.request.get(`${baseURL}/api/sync`);
  expect(response.status(), "The authenticated real sync endpoint must be available").toBe(200);
  return response.json();
}

async function assertLegacyIsolation(page: Page, identity: Identity) {
  const remote = await serverSnapshot(page);
  expect(remote.legacyImportAllowed, "Only a verified legacy owner may access a global journal; this fixture has no owner configuration").toBe(false);
  expect(JSON.stringify(remote.payload)).not.toContain(legacyMarker);
  expect(JSON.stringify(await localSnapshot(page, identity))).not.toContain(legacyMarker);
  await expect(page.locator(".migrationNotice")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Перенести историю", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("ritm-tracker-state-v1")), "The unrelated global record must remain intact, not be erased as a privacy workaround").toBe(legacyRaw);
}

async function saved(page: Page, predicate: (state: SessionTrackerState) => boolean, message: string) {
  await expect.poll(async () => {
    const snapshot = await serverSnapshot(page);
    return snapshot.payload !== null && predicate(snapshot.payload);
  }, { timeout: 30_000, message }).toBe(true);
}

async function localSnapshot(page: Page, identity: Identity): Promise<SessionTrackerState> {
  return page.evaluate((id) => JSON.parse(localStorage.getItem(`ritm-tracker-state-v1:${id}`) ?? "null"), identity.id);
}

async function commit(input: Locator, text: string) {
  await input.fill(text);
  await input.press("Tab");
}

async function checkLayout(page: Page, stateName: string) {
  for (const width of [375, 390, 430, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    const layout = await page.evaluate(() => {
      const bad: string[] = [];
      const selectors = ".primary,.secondary,.iconButton,.settingsTabs button,.bottomNav a,.globalRest a,input:not([type=checkbox]):not([type=radio]):not([type=file]),select,textarea";
      for (const element of document.querySelectorAll<HTMLElement>(selectors)) {
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height || getComputedStyle(element).visibility === "hidden") continue;
        const name = element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 60) ?? element.tagName;
        if (rect.left < -1 || rect.right > innerWidth + 1) bad.push(`${name}: outside viewport`);
        if (rect.width < 32 || rect.height < 32) bad.push(`${name}: control smaller than 32px`);
        if (Number.parseFloat(getComputedStyle(element).fontSize) < 12) bad.push(`${name}: text smaller than 12px`);
        for (const child of element.childNodes) {
          if (child.nodeType !== Node.TEXT_NODE || !child.textContent?.trim()) continue;
          const range = document.createRange(); range.selectNodeContents(child);
          const text = range.getBoundingClientRect();
          if (text.width && (text.left < rect.left - 1 || text.right > rect.right + 1 || text.top < rect.top - 1 || text.bottom > rect.bottom + 1)) bad.push(`${name}: text spills outside its control`);
        }
      }
      return { overflow: document.documentElement.scrollWidth > innerWidth, bad };
    });
    const description = `${stateName} at ${width}px: controls must fit and remain readable`;
    if (layout.overflow || layout.bad.length) {
      layoutDefects.push(`${description}: ${layout.overflow ? "horizontal overflow; " : ""}${layout.bad.join("; ")}`);
      console.log(`LAYOUT DEFECT: ${layoutDefects.at(-1)}`);
    }
    expect.soft(layout, description).toEqual({ overflow: false, bad: [] });
    if (width === 390 || width === 1440) {
      const directory = layout.overflow || layout.bad.length ? diagnosticDir : artifactDir;
      await page.screenshot({ path: `${directory}/${stateName}-${width}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
}

async function workerReady(page: Page, reloadGuestToTakeControl = false) {
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state ?? "absent"), { timeout: 15_000, message: "The real service worker must activate, not remain stuck installing" }).toBe("activated");
  if (reloadGuestToTakeControl && !await page.evaluate(() => !!navigator.serviceWorker.controller)) {
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15_000 }).toBe(true);
}

async function privateRouteCached(page: Page, identity: Identity) {
  await workerReady(page);
  await expect.poll(() => page.evaluate(async (id) => {
    for (const name of (await caches.keys()).filter((key) => key.startsWith("ritm-account-") && key.includes(id))) {
      const cached = await (await caches.open(name)).match(location.href);
      if (cached?.headers.get("x-ritm-account-id") === id) return true;
    }
    return false;
  }, identity.id), { timeout: 20_000, message: "Next Link navigation must capture an account-verified offline shell" }).toBe(true);
  const missing = await page.evaluate(async (id) => {
    const name = (await caches.keys()).find((key) => key.startsWith("ritm-account-") && key.includes(id));
    const response = name && await (await caches.open(name)).match(location.href);
    if (!response) return [];
    const document = new DOMParser().parseFromString(await response.text(), "text/html");
    const sources = [...document.querySelectorAll("script[src],link[rel=stylesheet][href]")].map((element) => new URL(element.getAttribute("src") ?? element.getAttribute("href")!, location.href)).filter((url) => url.origin === location.origin && url.pathname.startsWith("/_next/static/"));
    const missing: string[] = [];
    for (const url of sources) if (!await caches.match(url.href)) missing.push(`${url.pathname}${url.search}`);
    return missing;
  }, identity.id);
  if (missing.length) console.log(`PWA HTML ASSET CACHE DIAGNOSTIC: ${missing.join(", ")}`);
}

test("real local multi-account product journey, storage isolation and offline recovery", async ({ page, browser }, testInfo) => {
  layoutDefects.length = 0;
  expect(localOnly(baseURL), "This test is destructive only to its two disposable LOCAL fixture accounts").toBe(true);
  await protectLocalContext(page.context());
  const failures: string[] = [];
  const verified: string[] = [];
  const notVerified: string[] = [];
  const runtimeErrors: string[] = [];
  const brokenAssets: string[] = [];
  let blockedBySyncConflict = false;
  page.on("pageerror", (error) => { runtimeErrors.push(error.message); console.log(`BROWSER RUNTIME DEFECT: ${error.message}`); });
  page.on("requestfailed", (request) => console.log(`BROWSER NETWORK: ${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith("/_next/static/") && response.status() >= 400) {
      const broken = `${response.status()} ${path}`;
      brokenAssets.push(broken); console.log(`BROKEN APP ASSET: ${broken}`);
    }
  });
  async function phase(name: string, action: () => Promise<void>, prerequisite: () => boolean = () => true) {
    if (blockedBySyncConflict || !prerequisite()) { notVerified.push(name); console.log(`NOT VERIFIED: ${name}: ${blockedBySyncConflict ? "an earlier sync conflict blocks dependent writes" : "prerequisite fixture did not complete"}`); return; }
    try {
      await test.step(name, action);
      verified.push(name);
      console.log(`VERIFIED: ${name}`);
    } catch (error) {
      const description = `${name}: ${error instanceof Error ? error.message : String(error)}`;
      failures.push(description);
      console.log(`DEFECT: ${description}`);
      if (await page.locator(".syncConflict").isVisible().catch(() => false)) {
        blockedBySyncConflict = true;
        console.log("SYNC BLOCKER: a conflict is visible before another fixture device has written; dependent writes will not be misreported as separate defects");
      }
      await page.screenshot({ path: `${diagnosticDir}/failure-${name.replace(/[^a-z0-9-]/gi, "-").slice(0, 100)}.png`, fullPage: true }).catch(() => undefined);
    }
  }

  await phase("guest-login-and-service-worker", async () => {
    const guest = await page.request.get(`${baseURL}/api/sync`, { maxRedirects: 0 });
    expect(guest.status()).toBe(401);
    await page.goto(`${baseURL}/workouts`);
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    await expect(page.getByRole("heading", { name: "Вход", exact: true })).toBeVisible();
    await expect(page.locator(".programCard")).toHaveCount(0);
    // Next's local reverse proxy can redirect 127.0.0.1 to localhost; install the guest SW and fixture in the same origin used for Auth.
    await page.goto(`${baseURL}/login`);
    expect(new URL(page.url()).origin).toBe(new URL(baseURL).origin);
    expect(await page.evaluate(() => localStorage.getItem("ritm-tracker-state-v1")), "The fixture must start with a clean isolated context, not overwrite someone's global journal").toBeNull();
    await page.evaluate((raw) => localStorage.setItem("ritm-tracker-state-v1", raw), legacyRaw);
    await workerReady(page, true);
    const cachedPrivate = await page.evaluate(async () => (await caches.keys()).filter((key) => key.startsWith("ritm-account-")));
    expect(cachedPrivate).toEqual([]);
    await checkLayout(page, "guest-login");
  });

  await phase("native-and-pre-hydration-auth-never-put-credentials-in-url", async () => {
    for (const { path, javaScriptEnabled } of ["login", "register"].flatMap((path) => [false, true].map((javaScriptEnabled) => ({ path, javaScriptEnabled })))) {
      const native = await browser.newContext({ baseURL, javaScriptEnabled, viewport: { width: 390, height: 844 } });
      let releaseScripts: () => void = () => undefined;
      const scriptsHeld = new Promise<void>((resolve) => { releaseScripts = resolve; });
      const leaked: string[] = [];
      const requests: Array<{ method: string; path: string }> = [];
      try {
        await protectLocalContext(native);
        await native.route("**/*", async (route) => {
          const request = route.request();
          const url = new URL(request.url());
          if (url.searchParams.has("password") || request.url().includes(encodeURIComponent(accounts[0].password))) {
            leaked.push("credential-bearing query was attempted"); await route.abort("blockedbyclient"); return;
          }
          if (javaScriptEnabled && request.resourceType() === "script" && url.pathname.startsWith("/_next/static/")) {
            await scriptsHeld;
            await route.fallback().catch(() => undefined);
            return;
          }
          await route.fallback();
        });
        native.on("request", (request) => requests.push({ method: request.method(), path: new URL(request.url()).pathname }));
        const nativePage = await native.newPage();
        await nativePage.goto(`${baseURL}/${path}`, { waitUntil: "commit" });
        await expect(nativePage.getByRole("heading", { name: path === "login" ? "Вход" : "Создать аккаунт", exact: true })).toBeVisible();
        const email = nativePage.getByRole("textbox", { name: "Email", exact: true });
        const password = nativePage.getByLabel("Пароль", { exact: true });
        await expect(email, "Credentials cannot be entered before the protected submit handler is ready").toBeDisabled();
        await expect(password).toBeDisabled();
        expect(await nativePage.locator("form").getAttribute("method"), "SSR must never default a credentials form to GET").toMatch(/^post$/i);
        const submit = nativePage.getByRole("button", { name: path === "login" ? "Войти" : "Создать аккаунт", exact: true });
        await expect(submit).toBeDisabled();
        // Even native submission of the SSR form must use POST, never put credentials in a navigation URL.
        const nativePost = nativePage.waitForRequest((request) => request.isNavigationRequest() && request.method() === "POST");
        await nativePage.locator("form").evaluate((form: HTMLFormElement) => form.requestSubmit()).catch(() => undefined);
        await nativePost;
        expect(leaked, javaScriptEnabled ? "Before hydration" : "JavaScript disabled").toEqual([]);
        expect(requests.filter((request) => request.method === "GET" && request.path === "/api/auth/login")).toEqual([]);
      } finally { releaseScripts(); await native.close(); }
    }
  });

  const identity = await test.step("register-or-reuse-the-first-isolated-account", () => authenticate(page, accounts[0]));
  const admin = localAdminClient(identity);
  console.log(`QA ACCOUNT: primary ${identity.created ? "registered, immediate session" : "reused without another registration"}`);
  await phase("authenticated-account-and-private-offline-shell", async () => {
    if (identity.created) {
      const initial = (await serverSnapshot(page)).payload;
      expect(initial?.habits ?? []).toEqual([]);
      expect(initial?.workoutTemplates ?? []).toEqual([]);
      expect(initial?.workouts ?? []).toEqual([]);
      await expect(page.getByRole("heading", { name: "Ваш ритм дня" })).toBeVisible();
      console.log("VERIFIED: initial registration created an empty account, not a fabricated personal program");
    }
    await workerReady(page);
    const response = await page.request.get(`${baseURL}/today`);
    expect(response.headers()["x-ritm-account-id"]).toBe(identity.id);
    await checkLayout(page, "authenticated-today");
    await page.goto(`${baseURL}/settings`);
    await expect(page.getByRole("heading", { name: "Настройки", exact: true })).toBeVisible();
    await assertLegacyIsolation(page, identity);
  });

  const suffix = Date.now().toString(36);
  const programName = `QA Full Body ${suffix}`;
  const exerciseName = `QA Cable Press ${suffix}`;
  const breakfast = `QA Breakfast ${suffix}`;
  const chia = `QA Prepare ${suffix}`;
  const observationNote = `QA observation ${suffix}`;
  let templateId = "";
  let workoutId = "";
  let sessionId = "";
  let habitId = "";
  let dependentId = "";
  let photoPath = "";
  let workoutCompleted = false;

  await phase("reusable-isolated-fixture-preparation", async () => {
    await page.goto(`${baseURL}/settings`);
    await expect(page.getByRole("heading", { name: "Настройки", exact: true })).toBeVisible();
    const previous = (await serverSnapshot(page)).payload;
    const oldHabits = previous?.habits.filter((h) => !h.archived && /^QA (Breakfast|Prepare) /.test(h.title)) ?? [];
    for (const habit of oldHabits) {
      const editor = page.locator("details.exerciseDisclosure").filter({ has: page.locator("summary", { hasText: habit.title }) });
      await editor.locator("summary").click();
      await editor.getByRole("button", { name: "В архив", exact: true }).click();
    }
    if (oldHabits.length) await saved(page, (s) => oldHabits.every((old) => s.habits.find((h) => h.id === old.id)?.archived), "Earlier QA habits are archived, never erased");
    await page.goto(`${baseURL}/workouts`);
    await expect(page.getByRole("heading", { name: "Тренировки", exact: true })).toBeVisible();
    if (await page.locator("a.resumeBanner").count()) {
      await page.locator("a.resumeBanner").click();
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "Отменить", exact: true }).click();
      await expect(page).toHaveURL(/\/workouts$/);
      await expect(page.getByRole("heading", { name: "Тренировки", exact: true })).toBeVisible();
      await expect(page.locator("a.resumeBanner")).toHaveCount(0);
      await saved(page, (s) => !s.workoutSessions?.some((session) => session.status === "active"), "A previous unfinished QA run is cancelled with its facts retained");
    }
  });

  await phase("program-and-sequential-decimal-draft", async () => {
    await page.goto(`${baseURL}/settings?section=program`);
    await page.getByRole("button", { name: "Новая программа", exact: true }).click();
    await commit(page.getByRole("textbox", { name: "Название программы", exact: true }), programName);
    await page.getByRole("button", { name: "Добавить", exact: true }).click();
    const exercise = page.locator("details.exerciseDisclosure").filter({ has: page.locator("summary", { hasText: "Новое упражнение" }) }).last();
    await exercise.locator("summary").click();
    await commit(exercise.getByRole("textbox", { name: "Название", exact: true }), exerciseName);
    const editor = page.locator("details.exerciseDisclosure").filter({ has: page.locator("summary", { hasText: exerciseName }) });
    await commit(editor.getByRole("textbox", { name: "Группа мышц", exact: true }), "Грудь");
    await commit(editor.getByRole("textbox", { name: "Оборудование", exact: true }), "Cable machine");
    await commit(editor.getByRole("textbox", { name: "Положение оборудования", exact: true }), "Seat 3");
    await editor.getByRole("combobox", { name: "Отдых", exact: true }).selectOption("240");
    const weights = editor.getByRole("textbox", { name: "Вес", exact: true });
    await expect(weights).toHaveCount(4);
    const draft = weights.first();
    await draft.fill("");
    for (const [key, text] of [["1", "1"], ["2", "12"], [",", "12,"], ["5", "12,5"]]) {
      await draft.pressSequentially(key);
      await expect(draft, `Typing ${text} must not clear or normalize the unfinished draft`).toHaveValue(text);
    }
    await draft.press("Tab");
    await expect(draft).toHaveValue("12.5");
    for (let i = 1; i < 4; i++) await commit(weights.nth(i), "12,5");
    for (const mode of await editor.getByRole("combobox", { name: "Режим", exact: true }).all()) await mode.selectOption("total");
    await saved(page, (state) => state.workoutTemplates?.some((p) => p.title === programName && p.exercises[0]?.sets.every((s) => s.weightKg === 12.5 && s.weightMode === "total")) ?? false, "Every decimal weight and explicit weight mode must reach Postgres");
    templateId = (await serverSnapshot(page)).payload!.workoutTemplates!.find((p) => p.title === programName)!.id;
    await page.reload();
    await page.getByRole("combobox", { name: "Программа", exact: true }).selectOption(templateId);
    await page.locator("details.exerciseDisclosure summary").filter({ hasText: exerciseName }).click();
    await expect(page.getByRole("textbox", { name: "Вес", exact: true }).first()).toHaveValue("12.5");
    await checkLayout(page, "program-editor");

    await expect(page.getByText("Изменения сохранены", { exact: true })).toBeVisible();
    const cleanLocal = await localSnapshot(page, identity);
    const cleanRemote = await serverSnapshot(page);
    expect(syncFingerprint(cleanLocal), "Tab A must start clean with the same local and remote facts").toBe(syncFingerprint(cleanRemote.payload!));
    const checkpoint = await page.evaluate((id) => JSON.parse(localStorage.getItem(`ritm-tracker-state-v1:${id}:checkpoint`) ?? "null"), identity.id);
    expect(checkpoint).toEqual({ revision: cleanRemote.version, fingerprint: syncFingerprint(cleanLocal) });
    expect(await page.evaluate((id) => localStorage.getItem(`ritm-tracker-state-v1:${id}:sync-intent`), identity.id), "Tab A must have no pending write when it initializes").toBeNull();

    const tabB = await page.context().newPage();
    const tabBNote = `QA same-origin tab B observation ${suffix}`;
    const syncURL = `${baseURL}/api/sync`;
    let tabAPutCount = 0;
    const countTabAPut = (request: Request) => { if (new URL(request.url()).pathname === "/api/sync" && request.method() === "PUT") tabAPutCount++; };
    page.on("request", countTabAPut);
    let releaseResponse!: () => void;
    const responseHeld = new Promise<void>((resolve) => { releaseResponse = resolve; });
    let notifyServerCommitted!: (result: { revision: number; intent: SyncWriteIntent }) => void;
    let rejectServerCommitted!: (reason: unknown) => void;
    const serverCommitted = new Promise<{ revision: number; intent: SyncWriteIntent }>((resolve, reject) => { notifyServerCommitted = resolve; rejectServerCommitted = reject; });
    void serverCommitted.catch(() => undefined);
    const releaseOnClose = () => { releaseResponse(); rejectServerCommitted(new Error("Tab B closed before its committed write was checked by tab A")); };
    tabB.once("close", releaseOnClose);
    let interceptedRoute: Route | undefined;
    let heldRequest: Promise<void> | undefined;
    let commitTimeout: ReturnType<typeof setTimeout> | undefined;
    const holdObservation = async (route: Route) => {
      const request = route.request();
      if (request.method() !== "PUT" || interceptedRoute) { await route.fallback(); return; }
      const put = request.postDataJSON() as { payload: SessionTrackerState; expectedRevision: number };
      if (!put.payload.observations.some((o) => o.note === tabBNote && o.energy === 6 && o.sleep === 7)) { await route.fallback(); return; }
      interceptedRoute = route;
      heldRequest = (async () => {
        try {
          expect(localOnly(request.url())).toBe(true);
          const response = await route.fetch({ maxRedirects: 0, timeout: 30_000 });
          expect(response.status(), "Tab B's observation must actually commit on the real backend").toBe(200);
          const committed = await response.json() as { revision: number };
          expect(committed.revision).toBe(put.expectedRevision + 1);
          notifyServerCommitted({ revision: committed.revision, intent: { expectedRevision: put.expectedRevision, fingerprint: syncFingerprint(put.payload) } });
          await responseHeld;
        } catch (error) { rejectServerCommitted(error); }
        finally { await route.abort("failed").catch(() => undefined); }
      })();
      await heldRequest;
    };
    try {
      await tabB.route(syncURL, holdObservation);
      const initialized = tabB.waitForResponse((r) => new URL(r.url()).pathname === "/api/sync" && r.request().method() === "GET", { timeout: 15_000 });
      void initialized.catch(() => undefined);
      await tabB.goto(`${baseURL}/progress`);
      await expect(tabB.getByRole("textbox", { name: "Заметка", exact: true })).toBeVisible();
      const initialization = await initialized;
      expect(initialization.status()).toBe(200);
      expect(syncFingerprint((await initialization.json() as Snapshot).payload!)).toBe(syncFingerprint(cleanLocal));
      expect(new URL(tabB.url()).origin).toBe(new URL(page.url()).origin);
      await tabB.getByRole("textbox", { name: "Энергия, 0–10", exact: true }).fill("6");
      await tabB.getByRole("textbox", { name: "Сон, часов", exact: true }).fill("7");
      await tabB.getByRole("textbox", { name: "Заметка", exact: true }).fill(tabBNote);
      commitTimeout = setTimeout(() => rejectServerCommitted(new Error("Tab B's observation PUT did not commit within 30 seconds")), 30_000);
      await tabB.getByRole("button", { name: "Сохранить отметку", exact: true }).click();
      const committed = await serverCommitted;
      clearTimeout(commitTimeout);
      expect(committed.revision).toBe(cleanRemote.version + 1);
      const beforeTabA = await serverSnapshot(page);
      expect(beforeTabA.version).toBe(committed.revision);
      expect(syncFingerprint(beforeTabA.payload!)).toBe(committed.intent.fingerprint);
      expect(beforeTabA.payload!.observations).toContainEqual(expect.objectContaining({ note: tabBNote, energy: 6, sleep: 7 }));
      expect(await page.evaluate((id) => JSON.parse(localStorage.getItem(`ritm-tracker-state-v1:${id}:sync-intent`) ?? "null"), identity.id)).toEqual(committed.intent);
      expect(interceptedRoute!.request().failure(), "Tab B's committed PUT must still be awaiting its browser response").toBeNull();

      const tabAGet = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/sync" && r.request().method() === "GET", { timeout: 15_000 });
      void tabAGet.catch(() => undefined);
      await page.bringToFront();
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      const downloaded = await tabAGet;
      expect(downloaded.status()).toBe(200);
      expect((await downloaded.json() as Snapshot).payload!.observations).toContainEqual(expect.objectContaining({ note: tabBNote }));
      await expect(page.getByText("Изменения сохранены", { exact: true })).toBeVisible();
      // Client navigation reads A's existing provider; shared localStorage alone cannot prove A downloaded B's write.
      await page.getByRole("link", { name: "Прогресс", exact: true }).click();
      await expect(page).toHaveURL(/\/progress$/);
      await expect(page.getByRole("textbox", { name: "Заметка", exact: true })).toHaveValue(tabBNote);
      expect((await localSnapshot(page, identity)).observations).toContainEqual(expect.objectContaining({ note: tabBNote, energy: 6, sleep: 7 }));
      await expect(page.locator(".syncConflict")).toHaveCount(0);
      const afterTabA = await serverSnapshot(page);
      expect(afterTabA.version, "A clean tab must download without uploading its stale snapshot over B").toBe(committed.revision);
      expect(afterTabA.payload!.observations).toContainEqual(expect.objectContaining({ note: tabBNote, energy: 6, sleep: 7 }));
      expect(tabAPutCount, "Tab A made no edits and must not issue a PUT during recovery").toBe(0);
      expect(await page.evaluate((id) => JSON.parse(localStorage.getItem(`ritm-tracker-state-v1:${id}:sync-intent`) ?? "null"), identity.id), "Tab A must not consume tab B's pending write intent").toEqual(committed.intent);
      expect(interceptedRoute!.request().failure(), "Tab B's response must remain held until A has downloaded and verified its write").toBeNull();
    } finally {
      clearTimeout(commitTimeout);
      tabB.off("close", releaseOnClose);
      releaseResponse();
      try {
        if (!tabB.isClosed()) await tabB.unroute(syncURL, holdObservation).catch((error) => { if (!tabB.isClosed()) throw error; });
      } finally {
        try { await heldRequest; }
        finally { page.off("request", countTabAPut); await tabB.close(); }
      }
    }
  });

  await phase("four-set-session-rest-extension-skip-and-finish", async () => {
    expect(templateId, "Program setup is a prerequisite").toBeTruthy();
    await page.goto(`${baseURL}/workouts/templates/${templateId}`);
    await expect(page.getByRole("heading", { name: programName, exact: true })).toBeVisible();
    await checkLayout(page, "program-preview");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Начать тренировку", exact: true }).click();
    await expect(page).toHaveURL(/\/workout\/[^/]+$/);
    sessionId = new URL(page.url()).pathname.split("/").at(-1)!;
    await expect(page.getByRole("heading", { name: exerciseName, exact: true })).toBeVisible();
    await expect(page.locator(".workWeight strong")).toHaveText("12.5");
    await expect(page.locator(".workoutTimer")).toHaveText(/\d{2}:\d{2}/);
    const initialElapsed = await page.locator(".workoutTimer").innerText();
    await expect.poll(() => page.locator(".workoutTimer").innerText(), { timeout: 5000, message: "The session stopwatch must actually advance" }).not.toBe(initialElapsed);
    const before = await localSnapshot(page, identity);
    workoutId = before.workoutSessions!.find((s) => s.id === sessionId)!.workoutId;
    expect(before.workouts.find((w) => w.id === workoutId)!.exercises.flatMap((e) => e.sets).every((s) => !s.completed)).toBe(true);
    await checkLayout(page, "active-workout");
    await page.locator(".repsControl input").fill("0");
    await page.getByRole("button", { name: /^Записать / }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Укажи целое число повторений от 1 до 100." })).toBeVisible();
    expect((await localSnapshot(page, identity)).activeTimer).toBeNull();
    await page.locator(".repsControl input").fill("8");
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      (window as Window & { restoreQAStorage?: () => void }).restoreQAStorage = () => { Storage.prototype.setItem = original; };
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith("ritm-tracker-state-v1:")) throw new DOMException("QA quota failure", "QuotaExceededError");
        return original.call(this, key, value);
      };
    });
    try {
      await page.getByRole("button", { name: /^Записать / }).click();
      await expect(page.getByRole("alert").filter({ hasText: "Не удалось сохранить подход. Черновик оставлен, повтори действие." })).toBeVisible();
      const unsaved = await localSnapshot(page, identity);
      expect(unsaved.workouts.find((w) => w.id === workoutId)!.exercises[0].sets.some((s) => s.completed)).toBe(false);
      expect(unsaved.activeTimer).toBeNull();
      await expect(page.locator(".repsControl input")).toHaveValue("8");
    } finally { await page.evaluate(() => (window as Window & { restoreQAStorage?: () => void }).restoreQAStorage?.()); }
    for (let index = 0; index < 4; index++) {
      await expect(page.locator(".workoutProgress")).toContainText(`Подход ${index + 1} из 4`);
      await page.locator(".repsControl input").fill(String(8 + index));
      const commandRequest = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/workout/command" && request.method() === "POST" && String(request.postDataJSON()?.sourceEntityId ?? "").startsWith(`${workoutId}:`), { timeout: 30_000 }).catch(() => undefined);
      await page.getByRole("button", { name: /^Записать / }).click();
      await expect(page.locator(".restState")).toBeVisible();
      const local = await localSnapshot(page, identity);
      const workout = local.workouts.find((w) => w.id === workoutId)!;
      expect(workout.exercises[0].sets.filter((s) => s.completed)).toHaveLength(index + 1);
      expect(local.activeTimer?.durationSec).toBe(240);
      await saved(page, (state) => state.workouts.find((w) => w.id === workoutId)?.exercises[0].sets.filter((s) => s.completed).length === index + 1, "Confirmed sets must be persisted on the real server");
      await expect.poll(async () => (await localSnapshot(page, identity)).outbox.filter((c) => c.type === "workout.set.completed" && c.entityId?.startsWith(`${workoutId}:`)).every((c) => c.status === "accepted"), { timeout: 30_000, message: "The durable server command must acknowledge each set" }).toBe(true);
      if (index === 1) {
        await expect(page.locator(".syncConflict"), "The second set must sync without a false conflict after losing the cancellation PUT response").toHaveCount(0);
        expect((await serverSnapshot(page)).payload!.workouts.find((w) => w.id === workoutId)!.exercises[0].sets[1].reps).toBe(9);
      }
      const submitted = await commandRequest;
      expect(submitted, "The browser must submit the durable command, not only save a client snapshot").toBeTruthy();
      const body = submitted!.postDataJSON() as { commandKey: string; sourceEntityId: string; sourceVersion: number; dueAt: string; expiresAt: string };
      const beforeAcks = await serverSnapshot(page);
      // The trigger persists facts, commands, and jobs atomically. The current RPC is a read-only ACK, including on replay.
      const firstAck = await page.request.post(`${baseURL}/api/workout/command`, { data: body });
      expect(firstAck.status()).toBe(200);
      const accepted = await firstAck.json();
      expect(accepted.status).toBe("accepted");
      expect(accepted.command_id, "ACK must identify an already durable command, not merely return a success label").toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      const repeated = await page.request.post(`${baseURL}/api/workout/command`, { data: body });
      expect(repeated.status()).toBe(200);
      expect(await repeated.json()).toEqual(accepted);
      const afterAcks = await serverSnapshot(page);
      expect(afterAcks.version, "Neither ACK may change the saved snapshot revision").toBe(beforeAcks.version);
      expect(afterAcks.payload).toEqual(beforeAcks.payload);
      const command = await admin.from("commands").select("id,user_id,command_key,entity_id,version,command_type").eq("user_id", identity.id).eq("command_key", body.commandKey).eq("entity_id", body.sourceEntityId).eq("version", body.sourceVersion).eq("command_type", "workout.set.completed");
      expect(command.error).toBeNull();
      expect(command.data).toHaveLength(1);
      expect(command.data![0].id).toBe(accepted.command_id);
      const jobs = await admin.from("notification_jobs").select("id,user_id,source_entity_id,source_version,due_at,expires_at,status").eq("user_id", identity.id).eq("source_entity_id", body.sourceEntityId).eq("source_version", body.sourceVersion);
      expect(jobs.error).toBeNull();
      expect(jobs.data, "A confirmed future rest must have exactly one durable account-scoped queue job").toHaveLength(1);
      const job = jobs.data![0];
      expect(job.status).toBe("pending");
      expect(Date.parse(job.due_at)).toBe(Date.parse(body.dueAt));
      expect(Date.parse(job.expires_at)).toBe(Date.parse(body.expiresAt));
      expect(Date.parse(job.due_at)).toBeGreaterThan(Date.now());
      expect(Date.parse(job.expires_at)).toBeGreaterThan(Date.parse(job.due_at));
      if (index === 0) {
        expect(local.activeTimer?.endsAt).toBeTruthy();
        const endsAt = Date.parse(local.activeTimer!.endsAt!);
        await page.getByRole("button", { name: "+30 секунд", exact: true }).click();
        expect(Date.parse((await localSnapshot(page, identity)).activeTimer!.endsAt!) - endsAt).toBe(30_000);
        await checkLayout(page, "rest-timer");
        await page.getByRole("button", { name: "Свернуть", exact: true }).click();
        await expect(page).toHaveURL(/\/workouts$/);
        await expect(page.locator(".globalRest")).toBeVisible();
        await expect(page.locator(".globalRest")).toContainText("Отдых");
        await checkLayout(page, "persistent-rest");
        await page.getByRole("link", { name: "Настроить программы", exact: true }).click();
        await expect(page.getByRole("heading", { name: "Настройки", exact: true })).toBeVisible();
        await page.evaluate(() => window.scrollTo(0, 0));
        await expect(page.locator(".globalRest")).toBeInViewport({ ratio: 1 });
        await checkLayout(page, "persistent-rest-settings");
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await expect(page.locator(".globalRest")).toBeInViewport({ ratio: 1 });
        await page.locator(".globalRest a").click();
        await expect(page).toHaveURL(new RegExp(`/workout/${sessionId}$`));
        await expect(page.getByRole("heading", { name: exerciseName, exact: true })).toBeVisible();
        await privateRouteCached(page, identity);
        const persistedRest = (await localSnapshot(page, identity)).activeTimer;
        await page.context().setOffline(true);
        try {
          await page.reload({ waitUntil: "domcontentloaded" });
          await expect(page.locator(".restState")).toBeVisible({ timeout: 15_000 });
          await expect(page.locator(".restState")).toContainText("12.5 × 8");
          expect((await localSnapshot(page, identity)).activeTimer).toEqual(persistedRest);
          await checkLayout(page, "offline-active-rest");
        } finally { await page.context().setOffline(false); }
      }
      if (index === 0) {
        const syncURL = `${baseURL}/api/sync`;
        let releaseResponse!: () => void;
        const responseHeld = new Promise<void>((resolve) => { releaseResponse = resolve; });
        let notifyServerCommitted!: (revision: number) => void;
        let rejectServerCommitted!: (reason: unknown) => void;
        const serverCommitted = new Promise<number>((resolve, reject) => { notifyServerCommitted = resolve; rejectServerCommitted = reject; });
        void serverCommitted.catch(() => undefined);
        const releaseOnClose = () => {
          releaseResponse();
          rejectServerCommitted(new Error("The page closed before the injected cancellation flow completed"));
        };
        page.once("close", releaseOnClose);
        let interceptedRoute: Route | undefined;
        let heldRequest: Promise<void> | undefined;
        let commitTimeout: ReturnType<typeof setTimeout> | undefined;
        const holdCancellation = async (route: Route) => {
          const request = route.request();
          if (request.method() !== "PUT" || interceptedRoute) { await route.fallback(); return; }
          const put = request.postDataJSON() as { payload?: SessionTrackerState; expectedRevision: number };
          if (put.payload?.activeTimer !== null || !put.payload.workouts.some((w) => w.id === workoutId) || !put.payload.outbox.some((c) => c.type === "timer.cancelled" && c.entityId === body.sourceEntityId && c.version === 3)) {
            await route.fallback(); return;
          }
          interceptedRoute = route;
          heldRequest = (async () => {
            try {
              expect(localOnly(request.url())).toBe(true);
              // Commit to the real backend, then withhold its response until the old page has reloaded.
              const response = await route.fetch({ maxRedirects: 0, timeout: 30_000 });
              expect(response.status(), "The injected cancellation PUT must actually commit, not return a fabricated success").toBe(200);
              const committed = await response.json() as { revision: number };
              expect(committed.revision).toBe(put.expectedRevision + 1);
              notifyServerCommitted(committed.revision);
              await responseHeld;
            } catch (error) { rejectServerCommitted(error); }
            finally { await route.abort("failed").catch(() => undefined); }
          })();
          await heldRequest;
        };
        try {
          await page.route(syncURL, holdCancellation);
          commitTimeout = setTimeout(() => rejectServerCommitted(new Error("The cancellation PUT did not commit on the real backend within 30 seconds")), 30_000);
          await page.getByRole("button", { name: "Пропустить отдых", exact: true }).click();
          const committedRevision = await serverCommitted;
          clearTimeout(commitTimeout);
          await expect(page.locator(".restState")).toHaveCount(0);
          const committed = await serverSnapshot(page);
          expect(committed.version).toBe(committedRevision);
          expect(committed.payload!.activeTimer).toBeNull();
          expect(committed.payload!.outbox).toContainEqual(expect.objectContaining({ type: "timer.cancelled", entityId: body.sourceEntityId, version: 3 }));
          await page.locator(".repsControl input").fill("9");
          await page.getByRole("button", { name: "Свернуть", exact: true }).click();
          await expect(page).toHaveURL(/\/workouts$/);
          await page.locator("a.resumeBanner").click();
          await expect(page).toHaveURL(new RegExp(`/workout/${sessionId}$`));
          await expect(page.locator(".repsControl input")).toHaveValue("9");
          await privateRouteCached(page, identity);
          expect(interceptedRoute!.request().failure(), "The committed PUT must still be pending before the offline reload").toBeNull();
          await page.context().setOffline(true);
          await page.reload({ waitUntil: "domcontentloaded" });
          await expect(page.locator(".repsControl input")).toHaveValue("9", { timeout: 15_000 });
          const restored = await localSnapshot(page, identity);
          expect(restored.workouts.find((w) => w.id === workoutId)!.exercises[0].sets.filter((s) => s.completed)).toHaveLength(1);
          expect(restored.workouts.find((w) => w.id === workoutId)!.exercises[0].sets[1].repsDraft).toBe("9");
          expect(restored.activeTimer).toBeNull();
          await checkLayout(page, "offline-active-draft");
        } finally {
          clearTimeout(commitTimeout);
          page.off("close", releaseOnClose);
          releaseResponse();
          try {
            if (!page.isClosed()) await page.unroute(syncURL, holdCancellation).catch((error) => { if (!page.isClosed()) throw error; });
          } finally {
            await heldRequest;
            await page.context().setOffline(false);
          }
        }
        await expect(page.locator(".syncConflict"), "Reloading with a newer local draft must not create a sync conflict").toHaveCount(0);
      } else {
        await page.getByRole("button", { name: "Пропустить отдых", exact: true }).click();
        await expect(page.locator(".restState")).toHaveCount(0);
      }
    }
    await page.getByRole("button", { name: "Завершить тренировку", exact: true }).click();
    await page.getByRole("button", { name: "Подтвердить завершение", exact: true }).click();
    await expect(page.getByText("Тренировка завершена", { exact: true })).toBeVisible();
    await expect(page.locator(".summaryMetrics")).toContainText("4");
    await expect(page.locator(".summaryMetrics")).toContainText("475");
    await saved(page, (state) => state.workoutSessions?.find((s) => s.id === sessionId)?.status === "completed" && state.activeTimer === null, "A completed session must be a separate durable history record with no active rest");
    workoutCompleted = true;
    await checkLayout(page, "workout-summary");
  }, () => !!templateId);

  await phase("history-correction-and-second-browser", async () => {
    expect(workoutId, "An actual session is required").toBeTruthy();
    await page.goto(`${baseURL}/journal/workouts/${workoutId}`);
    await expect(page.getByRole("heading", { name: programName, exact: true })).toBeVisible();
    const row = page.locator(".historySet").first();
    await row.getByRole("textbox", { name: "Фактические повторы", exact: true }).fill("99");
    await row.getByRole("button", { name: "Отменить правки", exact: true }).click();
    await expect(row.getByRole("textbox", { name: "Фактические повторы", exact: true })).toHaveValue("8");
    await row.getByRole("textbox", { name: "Фактические повторы", exact: true }).fill("12");
    await row.getByRole("button", { name: "Сохранить исправление", exact: true }).click();
    await expect(page.getByText("Исправление сохранено на устройстве.", { exact: true })).toBeVisible();
    await saved(page, (state) => state.workouts.find((w) => w.id === workoutId)?.exercises[0].sets[0].reps === 12, "History corrections must persist without starting a rest timer");
    await row.getByRole("checkbox", { name: "Подход выполнен", exact: true }).uncheck();
    await row.getByRole("button", { name: "Сохранить исправление", exact: true }).click();
    await saved(page, (state) => state.workouts.find((w) => w.id === workoutId)?.exercises[0].sets[0].completed === false, "Undoing a historical fact must not delete its ID or inputs");
    expect((await serverSnapshot(page)).payload!.activeTimer).toBeNull();
    await row.getByRole("checkbox", { name: "Подход выполнен", exact: true }).check();
    await row.getByRole("button", { name: "Сохранить исправление", exact: true }).click();
    await saved(page, (state) => state.workouts.find((w) => w.id === workoutId)?.exercises[0].sets[0].completed === true, "A cancelled historical mark can be explicitly restored");
    const snapshot = (await serverSnapshot(page)).payload!;
    expect(snapshot.activeTimer).toBeNull();
    expect(snapshot.workoutTemplates!.find((p) => p.id === templateId)!.exercises[0].sets[0].reps).toBe(8);
    await page.reload();
    await expect(page.locator(".historySet").first().getByRole("textbox", { name: "Фактические повторы", exact: true })).toHaveValue("12");
    await checkLayout(page, "workout-history");
    const otherDevice = await browser.newContext({ baseURL, serviceWorkers: "allow", viewport: { width: 390, height: 844 } });
    try {
      await protectLocalContext(otherDevice);
      const remote = await otherDevice.newPage();
      await authenticate(remote, accounts[0]);
      await remote.goto(`${baseURL}/journal`);
      await expect(remote.locator("a.historyCard").filter({ hasText: programName })).toBeVisible();
      await remote.locator("a.historyCard").filter({ hasText: programName }).click();
      await expect(remote.locator(".historySet").first().getByRole("textbox", { name: "Фактические повторы", exact: true })).toHaveValue("12");
      const state = await localSnapshot(remote, identity);
      expect(state.workouts.find((w) => w.id === workoutId)?.exercises[0].sets.filter((s) => s.completed)).toHaveLength(4);
      expect(state.activeTimer).toBeNull();
      await remote.screenshot({ path: `${artifactDir}/second-browser-history-390.png`, fullPage: true });
    } finally { await otherDevice.close(); }
  }, () => workoutCompleted);

  await phase("habit-schedules-events-repeat-skip-and-archive", async () => {
    await page.goto(`${baseURL}/settings`);
    await page.getByRole("button", { name: "Добавить привычку", exact: true }).click();
    let editor = page.locator("details.exerciseDisclosure").filter({ has: page.locator("summary", { hasText: "Новая привычка" }) }).last();
    await editor.locator("summary").click();
    await commit(editor.getByRole("textbox", { name: "Название", exact: true }), breakfast);
    editor = page.locator("details.exerciseDisclosure").filter({ has: page.locator("summary", { hasText: breakfast }) });
    await editor.getByRole("combobox", { name: "Тип", exact: true }).selectOption("meal");
    await editor.getByLabel("Время (Москва)", { exact: true }).fill("09:00");
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Moscow", weekday: "short" }).format(new Date());
    const days = { Mon: "Пн", Tue: "Вт", Wed: "Ср", Thu: "Чт", Fri: "Пт", Sat: "Сб", Sun: "Вс" };
    for (const [key, label] of Object.entries(days)) if (key !== weekday) await editor.getByRole("checkbox", { name: label, exact: true }).uncheck();
    await page.getByRole("button", { name: "Добавить привычку", exact: true }).click();
    const newHabit = page.locator("details.exerciseDisclosure").filter({ has: page.locator("summary", { hasText: "Новая привычка" }) }).last();
    await newHabit.locator("summary").click();
    await commit(newHabit.getByRole("textbox", { name: "Название", exact: true }), chia);
    const child = page.locator("details.exerciseDisclosure").filter({ has: page.locator("summary", { hasText: chia }) });
    await child.getByRole("combobox", { name: "Когда", exact: true }).selectOption("event");
    await child.getByRole("combobox", { name: "После", exact: true }).selectOption({ label: breakfast });
    await commit(child.getByRole("textbox", { name: "Через, минут", exact: true }), "180");
    await child.getByRole("checkbox", { name: "Напоминать в Telegram", exact: true }).check();
    await saved(page, (state) => state.habits.some((h) => h.title === breakfast && h.time === "09:00" && h.daysOfWeek?.length === 1) && state.habits.some((h) => h.title === chia && !!h.afterHabitId && h.delayMinutes === 180), "Structured schedules and dependencies must persist");
    let state = (await serverSnapshot(page)).payload!;
    habitId = state.habits.find((h) => h.title === breakfast)!.id;
    dependentId = state.habits.find((h) => h.title === chia)!.id;
    await checkLayout(page, "habit-editor");
    await page.goto(`${baseURL}/today`);
    await expect(page.getByRole("button", { name: new RegExp(`^${chia}`) })).toContainText(`После: ${breakfast}`);
    const postpone = page.getByRole("button", { name: `Отложить ${chia} на 10 минут`, exact: true });
    for (let count = 1; count <= 3; count++) {
      await postpone.click();
      expect((await localSnapshot(page, identity)).habitSnoozes?.find((s) => s.habitId === dependentId)?.count).toBe(count);
    }
    await expect(postpone).toBeDisabled();
    await saved(page, (s) => s.habitSnoozes?.find((entry) => entry.habitId === dependentId)?.count === 3, "Manual postponement is durable and limited to three attempts");
    await page.getByRole("button", { name: new RegExp(`^${breakfast}`) }).click();
    await expect(page.getByRole("button", { name: new RegExp(`^${chia}`) })).toContainText("В ");
    await page.getByRole("button", { name: `Отменить отметку ${breakfast}`, exact: true }).click();
    await page.getByRole("button", { name: new RegExp(`^${breakfast}`) }).click();
    await saved(page, (s) => s.completions.filter((c) => c.habitId === habitId).length === 1, "Repeated mark/cancel/mark must preserve one fact for the day");
    await page.getByRole("button", { name: `Пропустить ${chia}`, exact: true }).click();
    await expect(page.getByRole("button", { name: new RegExp(`^${chia}`) })).toContainText("Пропущено");
    await expect(page.getByRole("heading", { name: "План дня закрыт", exact: true })).toBeVisible();
    await expect(page.getByText("1 из 2 выполнено", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: `Отменить отметку ${breakfast}`, exact: true }).click();
    await page.getByRole("button", { name: `Отменить отметку ${chia}`, exact: true }).click();
    await page.goto(`${baseURL}/settings`);
    const archived = page.locator("details.exerciseDisclosure").filter({ has: page.locator("summary", { hasText: chia }) });
    await archived.locator("summary").click();
    await archived.getByRole("button", { name: "В архив", exact: true }).click();
    await saved(page, (s) => !!s.habits.find((h) => h.id === dependentId)?.archived, "Archiving must not delete the habit");
    await page.goto(`${baseURL}/today`);
    await expect(page.getByRole("button", { name: new RegExp(`^${chia}`) })).toHaveCount(0);
    await expect(page.getByText("0 из 1 выполнено", { exact: true })).toBeVisible();
    await page.goto(`${baseURL}/settings`);
    await archived.locator("summary").click();
    await archived.getByRole("button", { name: "Вернуть из архива", exact: true }).click();
    await saved(page, (s) => s.habits.find((h) => h.id === dependentId)?.archived === false, "An archived habit can be restored");
    state = (await serverSnapshot(page)).payload!;
    expect(state.habits.find((h) => h.id === dependentId)?.afterHabitId).toBe(habitId);
  });

  await phase("observation-and-real-private-png-storage", async () => {
    await page.goto(`${baseURL}/progress`);
    await page.getByRole("textbox", { name: "Энергия, 0–10", exact: true }).fill("7");
    await page.getByRole("textbox", { name: "Сон, часов", exact: true }).fill("7,5");
    await page.getByRole("textbox", { name: "Масса, кг", exact: true }).fill("72,5");
    await page.getByRole("combobox", { name: "Самочувствие", exact: true }).selectOption("better");
    await page.getByRole("textbox", { name: "Заметка", exact: true }).fill(observationNote);
    await page.getByRole("button", { name: "Сохранить отметку", exact: true }).click();
    await saved(page, (s) => s.observations.some((o) => o.note === observationNote && o.energy === 7 && o.sleep === 7.5 && o.weightKg === 72.5), "An observation with decimal sleep and mass must persist");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=", "base64");
    await page.locator('input[type="file"]').setInputFiles({ name: `qa-${suffix}.png`, mimeType: "image/png", buffer: png });
    await expect(page.getByText("Фото загружено в приватное хранилище.", { exact: true })).toBeVisible({ timeout: 30_000 });
    await saved(page, (s) => s.photos?.some((p) => p.name === `qa-${suffix}.png` && !!p.storagePath) ?? false, "The uploaded photo reference must persist");
    photoPath = (await serverSnapshot(page)).payload!.photos!.find((p) => p.name === `qa-${suffix}.png`)!.storagePath!;
    expect(photoPath.startsWith(`${identity.id}/`)).toBe(true);
    const image = page.getByRole("img", { name: `qa-${suffix}.png`, exact: true });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((node) => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0)).toBe(true);
    const downloaded = await scopedClient(identity).storage.from("progress-photos").download(photoPath);
    expect(downloaded.error).toBeNull();
    expect(await downloaded.data!.arrayBuffer()).toEqual(png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength));
    const anonymous = createClient(identity.backendURL, identity.publicKey, { auth: { persistSession: false } });
    expect((await anonymous.storage.from("progress-photos").download(photoPath)).error).not.toBeNull();
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Масса, кг", exact: true })).toHaveValue("72.5");
    await expect(image).toBeVisible();
    await checkLayout(page, "private-progress");
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Экспорт данных и фото", exact: true }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toMatch(/^ritm-export-\d{4}-\d{2}-\d{2}\.json$/);
    const stream = await download.createReadStream();
    expect(stream).not.toBeNull();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    const exported = JSON.parse(Buffer.concat(chunks).toString("utf8")) as SessionTrackerState;
    if (workoutId) expect(exported.workouts.some((w) => w.id === workoutId)).toBe(true);
    expect(exported.observations.some((o) => o.note === observationNote)).toBe(true);
    const exportedPhoto = exported.photos!.find((p) => p.storagePath === photoPath)!;
    expect(exportedPhoto.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(Buffer.from(exportedPhoto.dataUrl.split(",")[1], "base64")).toEqual(png);
  });

  await phase("multi-date-import-preview-correction-and-deduplication", async () => {
    const text = `10.01\nQA Import A ${suffix}\n45x8,45x8,45x8,45x8\n11.01\nQA Import B ${suffix}\n12,5x8;20 отказ`;
    const beforeImport = (await serverSnapshot(page)).payload!;
    const originalCount = beforeImport.workouts.length;
    await page.goto(`${baseURL}/journal/import`);
    await page.getByRole("textbox", { name: "Исходный текст", exact: true }).fill("31.02.2025\nQA Invalid\n45x8");
    await page.getByRole("button", { name: "Предпросмотр", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Не удалось разобрать все даты или подходы." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Подтвердить импорт", exact: true })).toHaveCount(0);
    await page.getByRole("textbox", { name: "Исходный текст", exact: true }).fill(text);
    await page.getByRole("button", { name: "Предпросмотр", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Укажите год для дат без года." })).toHaveText("Укажите год для дат без года.");
    expect((await serverSnapshot(page)).payload!.workouts).toHaveLength(originalCount);
    await page.getByRole("textbox", { name: "Год для дат без года", exact: true }).fill("2025");
    await page.getByRole("button", { name: "Предпросмотр", exact: true }).click();
    const dates = page.locator('input[type="date"]');
    await expect(dates).toHaveCount(2);
    await expect(dates.nth(0)).toHaveValue("2025-01-10");
    await expect(dates.nth(1)).toHaveValue("2025-01-11");
    const first = page.locator(".importExercise").filter({ hasText: `QA Import A ${suffix}` });
    await expect(first.getByRole("textbox", { name: "Вес", exact: true })).toHaveCount(4);
    const second = page.locator(".importExercise").filter({ hasText: `QA Import B ${suffix}` });
    await expect(second.getByRole("textbox", { name: "Вес", exact: true }).first()).toHaveValue("12.5");
    await expect(second.getByRole("textbox", { name: "Повторы", exact: true }).last()).toHaveValue("");
    await commit(first.getByRole("textbox", { name: "Вес", exact: true }).first(), "46");
    for (const mode of await page.getByRole("combobox", { name: "Режим", exact: true }).all()) await mode.selectOption("total");
    await checkLayout(page, "import-preview");
    await page.getByRole("button", { name: "Подтвердить импорт", exact: true }).click();
    await expect(page.getByText("История сохранена. Новые таймеры не запускались.", { exact: true })).toBeVisible();
    await saved(page, (s) => s.workouts.filter((w) => w.sourceText === text).length === 2, "Both dates must persist only after explicit confirmation");
    const state = (await serverSnapshot(page)).payload!;
    expect(state.workouts).toHaveLength(originalCount + 2);
    expect(state.activeTimer).toEqual(beforeImport.activeTimer);
    expect(state.workouts.find((w) => w.date === "2025-01-11" && w.sourceText === text)!.exercises[0].sets[1].reps).toBeNull();
    // Reimport the corrected source so an identical fact is rejected, not silently duplicated.
    await page.getByRole("textbox", { name: "Исходный текст", exact: true }).fill(text.replace("45x8,45x8,45x8,45x8", "46x8,45x8,45x8,45x8"));
    await page.getByRole("button", { name: "Предпросмотр", exact: true }).click();
    await expect(page.getByRole("button", { name: "Подтвердить импорт", exact: true })).toBeDisabled();
    expect((await serverSnapshot(page)).payload!.workouts).toHaveLength(originalCount + 2);
  });

  await phase("telegram-unconfigured-state-without-real-bot", async () => {
    await page.goto(`${baseURL}/settings?section=telegram`);
    await expect(page.getByText("Не подключён", { exact: true })).toBeVisible();
    const unavailable = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/telegram/link" && r.request().method() === "POST");
    await page.getByRole("button", { name: "Подключить Telegram", exact: true }).click();
    expect((await unavailable).status(), "The parent deliberately started local Next without a real bot token").toBe(503);
    await expect(page.getByText("Не удалось выполнить запрос. Повторите попытку.", { exact: true })).toBeVisible();
    await expect(page.getByText("Ожидаем запуск бота", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Открыть бота", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Подключить Telegram", exact: true })).toBeEnabled();
    await checkLayout(page, "telegram-unconfigured");
  });

  await phase("portable-backup-preview-confirm-and-idempotent-restore", async () => {
    await page.goto(`${baseURL}/settings?section=data`);
    await expect(page.getByRole("heading", { name: "Резервная копия", exact: true })).toBeVisible();
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Скачать копию с фото", exact: true }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toMatch(/^ritm-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const stream = await download.createReadStream();
    expect(stream).not.toBeNull();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    const backup = JSON.parse(Buffer.concat(chunks).toString("utf8")) as BackupDocument;
    expect(backup.format).toBe("ritm-backup");
    expect(backup.accountId).toBe(identity.id);
    expect(backup.state.photos!.find((p) => p.name === `qa-${suffix}.png`)!.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(backup.state.photos!.every((p) => !p.storagePath)).toBe(true);
    const before = await localSnapshot(page, identity);
    const observationId = `qa-restore-${suffix}`;
    const restoredNote = `QA restored observation ${suffix}`;
    const restoredDate = Array.from({ length: 365 }, (_, index) => new Date(Date.UTC(new Date().getUTCFullYear() - 1, 0, index + 1)).toISOString().slice(0, 10)).find((date) => !backup.state.observations.some((o) => o.date === date))!;
    backup.state.observations.push({ id: observationId, date: restoredDate, energy: 6, sleep: 8, skin: "unknown", note: restoredNote });
    backup.state.workouts.find((w) => w.id === workoutId)!.exercises[0].sets[0].reps = 99;
    const buffer = Buffer.from(JSON.stringify(backup));
    const choose = page.getByLabel("Восстановить из JSON", { exact: true });
    await choose.setInputFiles({ name: "qa-restore.json", mimeType: "application/json", buffer });
    const restore = page.getByRole("button", { name: "Подтвердить восстановление", exact: true });
    await expect(restore).toBeDisabled();
    expect((await localSnapshot(page, identity)).observations.some((o) => o.id === observationId)).toBe(false);
    await checkLayout(page, "backup-preview");
    await page.getByRole("checkbox", { name: "Добавить новые записи, сохранив существующие данные и резервную копию.", exact: true }).check();
    await restore.click();
    await expect(page.getByText("Новые записи добавлены на устройство.", { exact: false })).toBeVisible();
    await saved(page, (s) => s.observations.some((o) => o.id === observationId && o.note === restoredNote), "An explicitly confirmed backup must reach the server");
    const restored = (await serverSnapshot(page)).payload!;
    expect(restored.workouts.find((w) => w.id === workoutId)!.exercises[0].sets[0].reps).toBe(12);
    expect(restored.activeTimer).toEqual(before.activeTimer);
    expect(restored.outbox.map((c) => c.id)).toEqual(before.outbox.map((c) => c.id));
    const originals = await page.evaluate((id) => Object.keys(localStorage).filter((key) => key.startsWith(`ritm-tracker-state-v1:${id}:before-import:`)).map((key) => JSON.parse(localStorage.getItem(key)!)), identity.id);
    expect(originals.some((s: SessionTrackerState) => !s.observations.some((o) => o.id === observationId) && s.workouts.some((w) => w.id === workoutId))).toBe(true);
    await choose.setInputFiles({ name: "qa-restore.json", mimeType: "application/json", buffer });
    await expect(page.getByText("В этой копии нет новых доступных записей для добавления.", { exact: true })).toBeVisible();
    await expect(restore).toHaveCount(0);
    expect((await serverSnapshot(page)).payload!.observations.filter((o) => o.id === observationId)).toHaveLength(1);
  }, () => workoutCompleted && !!photoPath);

  await phase("offline-reload-local-action-and-online-outbox-recovery", async () => {
    expect(habitId, "Habit setup is a prerequisite").toBeTruthy();
    await page.goto(`${baseURL}/today`);
    const cancelPrior = page.getByRole("button", { name: `Отменить отметку ${breakfast}`, exact: true });
    if (await cancelPrior.count()) {
      await cancelPrior.click();
      await saved(page, (s) => !s.completions.some((c) => c.habitId === habitId), "Offline action starts from an explicitly unmarked QA habit");
    }
    await workerReady(page);
    await expect.poll(() => page.evaluate(async (id) => {
      const names = (await caches.keys()).filter((name) => name.startsWith("ritm-account-") && name.includes(id));
      for (const name of names) if (await (await caches.open(name)).match(location.href)) return true;
      return false;
    }, identity.id), { timeout: 20_000, message: "An authenticated shell must be cached separately from login" }).toBe(true);
    const cacheAudit = await page.evaluate(async () => {
      const wrong: string[] = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          const path = new URL(request.url).pathname;
          if (path.startsWith("/api/") || path.includes("progress-photos") || (name.startsWith("ritm-account-") && ["/login", "/register", "/update-password"].includes(path))) wrong.push(`${name}:${path}`);
        }
      }
      return wrong;
    });
    expect(cacheAudit).toEqual([]);
    await page.context().setOffline(true);
    try {
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Сегодня", exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("heading", { name: "Вход", exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: new RegExp(`^${breakfast}`) }).click();
      const state = await localSnapshot(page, identity);
      expect(state.completions.some((c) => c.habitId === habitId)).toBe(true);
      expect(state.outbox.some((c) => c.type === "habit.completed" && c.entityId?.includes(habitId) && c.status === "pending")).toBe(true);
      await checkLayout(page, "offline-today");
    } finally { await page.context().setOffline(false); }
    await saved(page, (s) => s.completions.some((c) => c.habitId === habitId), "Reconnect must replay the offline fact without clearing history");
    await expect.poll(async () => (await localSnapshot(page, identity)).outbox.filter((c) => c.entityId?.includes(habitId)).every((c) => c.status === "accepted"), { timeout: 30_000 }).toBe(true);
    await page.reload();
    await expect(page.getByRole("button", { name: new RegExp(`^${breakfast}`) })).toContainText("Выполнено");
  }, () => !!habitId);

  await phase("second-user-isolation-shared-browser-and-storage-rls", async () => {
    const secondContext = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, serviceWorkers: "allow" });
    let second: Identity;
    try {
      await protectLocalContext(secondContext);
      const secondPage = await secondContext.newPage();
      second = await authenticate(secondPage, accounts[1]);
      expect(second.id).not.toBe(identity.id);
      const foreign = await scopedClient(second).from("tracker_state").select("user_id").eq("user_id", identity.id);
      expect(foreign.error).toBeNull();
      expect(foreign.data).toEqual([]);
      if (photoPath) expect((await scopedClient(second).storage.from("progress-photos").download(photoPath)).error).not.toBeNull();
      const untrustedCommands = await scopedClient(second).from("notification_jobs").select("id").limit(1);
      expect(untrustedCommands.error, "Browser authenticated roles must not read the worker's service queue").not.toBeNull();
    } finally { await secondContext.close(); }
    const preserved = await localSnapshot(page, identity);
    await page.goto(`${baseURL}/settings`);
    await page.getByRole("button", { name: "Выйти", exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
    expect(await localSnapshot(page, identity), "Logout must preserve the first account's local history and outbox").toEqual(preserved);
    const otherIdentity = await authenticate(page, accounts[1]);
    expect(otherIdentity.id).toBe(second!.id);
    await page.goto(`${baseURL}/settings`);
    await expect(page.getByRole("heading", { name: "Настройки", exact: true })).toBeVisible();
    await assertLegacyIsolation(page, otherIdentity);
    await page.goto(`${baseURL}/workouts`);
    await expect(page.locator("a.programCard").filter({ hasText: programName })).toHaveCount(0);
    await page.goto(`${baseURL}/journal`);
    await expect(page.locator("a.historyCard").filter({ hasText: programName })).toHaveCount(0);
    await page.goto(`${baseURL}/progress`);
    await expect(page.getByRole("img", { name: `qa-${suffix}.png`, exact: true })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Заметка", exact: true })).not.toHaveValue(observationNote);
    const secondState = (await serverSnapshot(page)).payload;
    expect(secondState?.workouts.some((w) => w.id === workoutId) ?? false).toBe(false);
    expect(secondState?.habits.some((h) => h.id === habitId) ?? false).toBe(false);
    await checkLayout(page, "second-account");
  });

  console.log(`PRODUCT QA RESULT: ${verified.length} verified functional phases; ${failures.length} functional defects; ${layoutDefects.length} layout assertion failures; browser=${testInfo.project.name || browserName}`);
  console.log(`VERIFIED PHASES: ${verified.join(", ")}`);
  console.log(`NOT VERIFIED PHASES: ${notVerified.join(", ") || "none"}`);
  console.log(`LAYOUT DEFECTS: ${layoutDefects.join(" | ") || "none"}`);
  console.log("TELEGRAM: real delivery and owner linking were deliberately not exercised; this suite only verifies durable local backend workout acknowledgements.");
  expect(runtimeErrors, "The product journey must not produce uncaught browser errors").toEqual([]);
  expect(brokenAssets, "The running server must serve all of its referenced JavaScript and CSS assets").toEqual([]);
  expect(failures, "All independent phases were attempted; screenshots retain the exact failure states").toEqual([]);
  expect(notVerified, "A passing release run requires every fixture-dependent phase to have been exercised").toEqual([]);
});
