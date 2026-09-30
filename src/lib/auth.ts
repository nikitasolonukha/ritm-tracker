export function validateEmail(email: unknown): string | null {
  if (typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "Введите корректный email.";
  return null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateRegistration(email: unknown, password: unknown): string | null {
  const invalidEmail = validateEmail(email);
  if (invalidEmail) return invalidEmail;
  if (typeof password !== "string" || password.length < 8 || password.length > 128 || !/\S/.test(password)) return "Пароль должен содержать от 8 до 128 символов и не состоять только из пробелов.";
  return null;
}

export function safeAuthRedirect(value: string | null | undefined): string {
  if (!value || value.length > 2048 || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) return "/today";
  try {
    const target = new URL(value, "https://ritm.invalid");
    if (target.origin !== "https://ritm.invalid" || ["/login", "/register", "/update-password", "/api", "/_next"].some((path) => target.pathname === path || target.pathname.startsWith(`${path}/`))) return "/today";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch { return "/today"; }
}

export function isRegisteredUser(user: { id?: unknown; email?: unknown; is_anonymous?: unknown } | null | undefined): boolean {
  return Boolean(user && typeof user.id === "string" && user.id && typeof user.email === "string" && user.email && user.is_anonymous !== true);
}

export function isAuthServiceUnavailable(error: { status?: number; code?: string; name?: string } | null | undefined): boolean {
  return Boolean(error && (error.status === 0 || (error.status !== undefined && error.status >= 500) || error.name === "AuthRetryableFetchError" || error.code === "unexpected_failure"));
}

type RegistrationBody = { ok: true; email: string; password: string } | { ok: false; status: number; error: string; message?: string };

type RegistrationOriginPolicy = { appUrl?: string; vercel?: boolean; deploymentHost?: string; productionHost?: string; localDevelopment?: boolean };

export function isRegistrationOriginAllowed(request: Request, policy: RegistrationOriginPolicy = {}): boolean {
  const origin = request.headers.get("origin");
  if (!origin || request.headers.get("sec-fetch-site") === "cross-site") return false;
  try {
    const source = new URL(origin);
    const target = new URL(request.url);
    if (!["http:", "https:"].includes(source.protocol) || source.origin !== origin) return false;
    const host = request.headers.get("host")?.toLowerCase();
    if (origin === target.origin && (!host || host === source.host)) return true;
    const forwardedHost = policy.vercel ? request.headers.get("x-forwarded-host")?.toLowerCase() : undefined;
    const trustedOrigins = new Set<string>();
    if (policy.appUrl) trustedOrigins.add(new URL(policy.appUrl).origin);
    if (policy.vercel) {
      for (const deployment of [policy.deploymentHost, policy.productionHost]) {
        if (deployment && /^[a-z0-9.-]+$/i.test(deployment)) trustedOrigins.add(`https://${deployment.toLowerCase()}`);
      }
    }
    // Forwarded headers never introduce a new allowed origin; only deployment configuration can.
    if (trustedOrigins.has(origin) && (host === source.host || forwardedHost === source.host)) return true;
    const loopback = (hostname: string) => ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
    // Next dev can build request.url with localhost although the browser sent Host: 127.0.0.1.
    return Boolean(policy.localDevelopment && !policy.vercel && loopback(target.hostname) && loopback(source.hostname) && source.protocol === target.protocol && source.port === target.port && host === source.host);
  } catch { return false; }
}

export async function readRegistrationBody(request: Request, policy: RegistrationOriginPolicy = {}): Promise<RegistrationBody> {
  if (!isRegistrationOriginAllowed(request, policy)) return { ok: false, status: 403, error: "forbidden" };
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") return { ok: false, status: 415, error: "invalid_input" };
  const length = request.headers.get("content-length");
  if (length !== null && !/^\d+$/.test(length)) return { ok: false, status: 400, error: "invalid_input" };
  if (Number(length) > 2048) return { ok: false, status: 413, error: "invalid_input" };
  if (!request.body) return { ok: false, status: 400, error: "invalid_input" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    // Check bytes from the stream too: Content-Length is optional and can be dishonest.
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2048) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, status: 413, error: "invalid_input" };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const body: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, status: 400, error: "invalid_input" };
    const { email, password } = body as { email?: unknown; password?: unknown };
    const invalid = validateRegistration(email, password);
    if (invalid) return { ok: false, status: 400, error: "invalid_input", message: invalid };
    return { ok: true, email: normalizeEmail(email as string), password: password as string };
  } catch { return { ok: false, status: 400, error: "invalid_input" }; }
  finally { reader.releaseLock(); }
}

export function authErrorMessage(code?: string): string {
  if (code === "invalid_credentials") return "Неверный email или пароль.";
  if (code === "email_exists" || code === "user_already_exists") return "Этот email уже зарегистрирован. Войдите или восстановите пароль.";
  if (code === "over_request_rate_limit" || code === "rate_limited") return "Слишком много попыток. Попробуйте позже.";
  if (code === "over_email_send_rate_limit") return "Письмо уже запрошено. Подождите немного перед повторной отправкой.";
  if (code === "weak_password") return "Выберите более надёжный пароль длиной не менее 8 символов.";
  if (code === "invalid_input" || code === "email_address_invalid") return "Проверьте email и пароль.";
  if (code === "not_configured") return "Сервис ещё не настроен. Попробуйте позже.";
  if (code === "unavailable") return "Сервис временно недоступен. Попробуйте позже.";
  if (code === "forbidden") return "Не удалось подтвердить запрос. Обновите страницу и попробуйте снова.";
  if (code === "email_not_confirmed") return "Аккаунт ещё не активирован. Обратитесь в поддержку.";
  return "Не удалось выполнить запрос. Проверьте соединение и попробуйте снова.";
}
