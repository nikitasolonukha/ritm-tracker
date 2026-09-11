# TEST_REPORT

Дата: 2026-09-11

Кодовый commit: `pending` (этот отчёт обновляется вместе с изменением изоляции legacy storage).

## Локально проверено

- Основной Node test suite: **44 passed, 0 failed**.
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
- Текущий подтвержденный production deployment: `dpl_EqwGdgRzaP87Hvf9jPaUyqYE5YK2` (READY), alias `https://ritm-tracker.vercel.app/`.
- Production smoke после deployment: `/` -> `200` с оболочкой входа, `/manifest.webmanifest` -> `200`, `/sw.js` -> `200`, webhook GET -> `405` (маршрут доступен и принимает только POST).
- Vercel Production variables присутствуют; production `/` показывает обычный вход без `reason=not-configured`.
- Supabase project `wlaojddckdebbeqafbbg`: миграции `persistent_telegram_links` и `workout_timer_commands` применены; timer RPC доступен `authenticated`, недоступен `anon`, прямые INSERT в служебные `commands` и `notification_jobs` для `authenticated` запрещены.
- Telegram `getMe` подтверждает `@solonflowai_treker_bot`.
- `getWebhookInfo`: webhook установлен на production, `pending_update_count=0`, `last_error=null`.
- Реальная привязка Telegram проверена по сообщению пользователя: deep-link `/start <token>` получил ответ «Telegram подключен к Ритму.»

## Не проверено и не объявляется готовым

- Реальная отправка production job в Telegram — **НЕ ПРОВЕРЕНО**: pending job не создавался, чтобы не отправлять пользователю искусственное тестовое сообщение.
- Production `+30` с заменой dueAt и production cancel — **НЕ ПРОВЕРЕНО**.
- `pg_cron`, `pg_net` и `supabase_vault` включены; job `ritm-telegram-worker-every-10-seconds` активен. После redeploy последние вызовы worker получили HTTP `200` и `processed: 0`; активная Telegram-привязка существует, pending jobs нет.
- Два устройства/два аккаунта и полноценное conflict resolution — **НЕ ПРОВЕРЕНО**.
- Явный перенос legacy storage реализован, но на production не подтверждался на реальном аккаунте, чтобы не менять личный журнал.
- Chromium Playwright остаётся ограничен Windows `spawn EPERM`; WebKit smoke пройден отдельно.
- Полный iPhone offline/background/lock-screen сценарий — **НЕ ПРОВЕРЕНО**.
- RLS для посторонней таблицы `public.RAGformyAIagent` не менялся; её назначение и корректные политики не подтверждены.
- Supabase security advisors также сообщают о mutable `search_path` у старых `set_updated_at`/`match_documents` и отключённой leaked-password protection; эти настройки требуют отдельного решения владельца проекта.

## Ограничения теста

Production account использовался read-only. Реальная тестовая тренировка и job не создавались, чтобы не добавлять лишнюю запись в личный журнал.
