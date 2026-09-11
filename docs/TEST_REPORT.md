# TEST_REPORT

Дата: 2026-09-11

Кодовый commit: `46e81fd` (`fix: fail closed when Telegram bot token is missing`).

## Локально проверено

- Основной Node test suite: **46 passed, 0 failed**.
- ESLint и TypeScript: passed.
- `next build`: passed; в сборке присутствуют middleware и `/api/workout/timer`.
- WebKit smoke на production build: anonymous `/` -> `/login?reason=not-configured`, webhook/worker без секрета `401`, manifest и service worker `200`.
- WebKit установлен и headless запуск подтвержден.
- Timer helper: version 1 -> reschedule version 2 (+30) -> cancel version 3.
- Outbox acknowledgement после успешного command request сохраняется в отдельном user-scoped localStorage ключе; основной sync payload не изменяется.
- Добавлен тест изоляции ack между пользователями и сохранения ack после reload.
- User-scoped storage больше не подхватывает глобальную legacy-запись автоматически; добавлен регрессионный тест. Старые данные сохраняются и предлагаются для явного переноса в авторизованных настройках.

## Production и Telegram

- Production URL: `https://ritm-tracker.vercel.app/`.
- Текущий подтвержденный production deployment: `dpl_BZed9SoEfdz1RQGGVCFGqm3e1uwg` (READY), alias `https://ritm-tracker.vercel.app/`.
- Production smoke после deployment: `/` -> `200` с оболочкой входа, `/manifest.webmanifest` -> `200`, `/sw.js` -> `200`, webhook GET -> `405` (маршрут доступен и принимает только POST).
- Vercel Production variables присутствуют; production `/` показывает обычный вход без `reason=not-configured`.
- Supabase project `wlaojddckdebbeqafbbg`: миграции `persistent_telegram_links` и `workout_timer_commands` применены; timer RPC доступен `authenticated`, недоступен `anon`, прямые INSERT в служебные `commands` и `notification_jobs` для `authenticated` запрещены.
- Telegram `getMe` подтверждает `@solonflowai_treker_bot`.
- `getWebhookInfo`: webhook установлен на production, `pending_update_count=0`, `last_error=null`.
- Реальная привязка Telegram проверена по сообщению пользователя: deep-link `/start <token>` получил ответ «Telegram подключен к Ритму.»
- Повторная генерация ссылки теперь обновляет `token_expires_at`; webhook проверяет срок токена, а не срок постоянного подключения.
- Worker записывает сетевую неопределённость Telegram как `unknown`, проверяет результат финализации job и не объявляет очередь обработанной при ошибке записи.
- Telegram rest callbacks (`+30 секунд` / `Пропустить`) реализованы через server-side RPC `accept_telegram_timer_command`; RPC применена в Supabase, доступна только `service_role`, `anon` не имеет execute.
- Supabase migrations `telegram_timer_callbacks` (`20260911111446`) и `telegram_timer_callback_versions` (`20260911112710`) применены; последовательные `+30 секунд` получают новые source versions. Cron job `ritm-telegram-worker-every-10-seconds` активен с интервалом 10 секунд, последние вызовы worker: HTTP `200`, `processed: 0`.
- Webhook fail-closed проверяет наличие `TELEGRAM_BOT_TOKEN` до обработки update и callback.
- На собранном Next с Supabase URL/key, но без `RITM_OWNER_USER_ID`, приватный `/` проверен через HTTP: `307` на `/login?reason=not-configured`.
- При обнаружении revision-конфликта UI предлагает оставить локальную или серверную копию; обе версии сначала сохраняются в user-scoped резервные записи, а выбор локальной копии выполняет повторный owner-scoped PUT с актуальной revision. Фактический сценарий на двух устройствах пока не запускался.

## Не проверено и не объявляется готовым

- Реальная отправка production job в Telegram — **НЕ ПРОВЕРЕНО**: pending job не создавался, чтобы не отправлять пользователю искусственное тестовое сообщение.
- Реальные callback update и `answerCallbackQuery` в Telegram — **НЕ ПРОВЕРЕНО**: production job с кнопками намеренно не создавался.
- Production `+30` с заменой dueAt и production cancel — **НЕ ПРОВЕРЕНО**.
- `pg_cron`, `pg_net` и `supabase_vault` включены; job `ritm-telegram-worker-every-10-seconds` активен. После последнего redeploy вызовы worker получили HTTP `200` и `processed: 0`; активная Telegram-привязка существует, pending jobs нет.
- Два устройства/два аккаунта и полноценное conflict resolution — **НЕ ПРОВЕРЕНО**.
- Явный перенос legacy storage реализован, но на production не подтверждался на реальном аккаунте, чтобы не менять личный журнал.
- Chromium Playwright остаётся ограничен Windows `spawn EPERM`; WebKit smoke пройден отдельно.
- Полный iPhone offline/background/lock-screen сценарий — **НЕ ПРОВЕРЕНО**.
- RLS для посторонней таблицы `public.RAGformyAIagent` не менялся; её назначение и корректные политики не подтверждены.
- Supabase security advisors также сообщают о mutable `search_path` у старых `set_updated_at`/`match_documents` и отключённой leaked-password protection; эти настройки требуют отдельного решения владельца проекта.

## Ограничения теста

Production account использовался read-only. Реальная тестовая тренировка и job не создавались, чтобы не добавлять лишнюю запись в личный журнал.
