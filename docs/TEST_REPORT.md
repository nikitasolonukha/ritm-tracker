# TEST_REPORT

Дата: 2026-09-11

Кодовый commit: `b36e352`.

## Локально проверено

- Основной Node test suite: **42 passed, 0 failed**.
- ESLint и TypeScript: passed.
- `next build`: passed; в сборке присутствуют middleware и `/api/workout/timer`.
- WebKit smoke на production build: anonymous `/` -> `/login?reason=not-configured`, webhook/worker без секрета `401`, manifest и service worker `200`.
- WebKit установлен и headless запуск подтвержден.
- Timer helper: version 1 -> reschedule version 2 (+30) -> cancel version 3.

## Production и Telegram

- Production URL: `https://ritm-tracker.vercel.app/`.
- Текущий подтвержденный production deployment: `dpl_9RygqE7s1Bz6u5MhLmp4kHkmVhun` (READY), alias `https://ritm-tracker.vercel.app/`.
- Production smoke после deployment: `/` -> `200` с оболочкой входа, `/manifest.webmanifest` -> `200`, `/sw.js` -> `200`, webhook GET -> `405` (маршрут доступен и принимает только POST).
- Vercel Production variables присутствуют; production `/` показывает обычный вход без `reason=not-configured`.
- Supabase project `wlaojddckdebbeqafbbg`: миграции `persistent_telegram_links` и `workout_timer_commands` применены; timer RPC доступен `authenticated`, недоступен `anon`, прямые INSERT в служебные `commands` и `notification_jobs` для `authenticated` запрещены.
- Telegram `getMe` подтверждает `@solonflowai_treker_bot`.
- `getWebhookInfo`: webhook установлен на production, `pending_update_count=0`, `last_error=null`.
- Реальная привязка Telegram проверена по сообщению пользователя: deep-link `/start <token>` получил ответ «Telegram подключен к Ритму.»

## Не проверено и не объявляется готовым

- Production job через `notification_jobs -> scheduler -> worker -> Telegram` на 60 секунд — **НЕ ПРОВЕРЕНО**.
- Production `+30` с заменой dueAt и production cancel — **НЕ ПРОВЕРЕНО**.
- pg_cron/pg_net/Vault scheduler — **НЕ ПРОВЕРЕНО**.
- Два устройства/два аккаунта и полноценное conflict resolution — **НЕ ПРОВЕРЕНО**.
- Chromium Playwright остаётся ограничен Windows `spawn EPERM`; WebKit smoke пройден отдельно.
- Полный iPhone offline/background/lock-screen сценарий — **НЕ ПРОВЕРЕНО**.
- RLS для посторонней таблицы `public.RAGformyAIagent` не менялся; её назначение и корректные политики не подтверждены.
- Supabase security advisors также сообщают о mutable `search_path` у старых `set_updated_at`/`match_documents` и отключённой leaked-password protection; эти настройки требуют отдельного решения владельца проекта.

## Ограничения теста

Production account использовался read-only. Реальная тестовая тренировка и job не создавались, чтобы не добавлять лишнюю запись в личный журнал.
