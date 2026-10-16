// Сквозные сценарии в демо-режиме на боевой сборке: без Supabase и без dev-сервера, поэтому без случайных перезагрузок.
// Запуск: pnpm test:e2e:demo [--project=chromium] [другие аргументы playwright]
import { spawn, spawnSync } from "node:child_process";

const port = "3002";
const env = { ...process.env, RITM_DEMO_MODE: "1" };
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const shell = process.platform === "win32";

const build = spawnSync(pnpm, ["build"], { env, stdio: "inherit", shell });
if (build.status !== 0) process.exit(build.status ?? 1);

const server = spawn(pnpm, ["exec", "next", "start", "-H", "127.0.0.1", "-p", port], { env, stdio: "ignore", shell });
const stop = () => { if (shell) spawnSync("taskkill", ["/pid", String(server.pid), "/t", "/f"], { stdio: "ignore" }); else server.kill(); };
process.on("exit", stop);

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { const response = await fetch(`http://127.0.0.1:${port}/login`); if (response.ok) return; } catch { /* ещё не поднялся */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Сервер не поднялся за 60 секунд");
}

try {
  await waitForServer();
  const args = process.argv.slice(2);
  const specs = ["tests/e2e/app-journeys.spec.ts", "tests/e2e/app-journeys-more.spec.ts", "tests/e2e/workout-demo.spec.ts", "tests/e2e/settings.spec.ts", "tests/e2e/features-v16.spec.ts"];
  const projects = args.some((arg) => arg.startsWith("--project")) ? [] : ["--project=chromium", "--project=iphone"];
  const run = spawnSync(pnpm, ["exec", "playwright", "test", ...specs, ...projects, ...(args.some((arg) => arg.startsWith("--workers")) ? [] : ["--workers=4"]), ...args], { env, stdio: "inherit", shell });
  stop();
  process.exit(run.status ?? 1);
} catch (error) {
  console.error(error);
  stop();
  process.exit(1);
}
