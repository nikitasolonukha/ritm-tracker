# TEST_REPORT

Дата: 2026-09-11

Кодовый commit: `dc4109a` (`fix: upload local state when remote is empty`).

## Локально проверено

- Основной Node test suite: **48 passed, 0 failed**.
- ESLint и TypeScript: passed.
- `next build`: passed; в сборке присутствуют middleware и `/api/workout/timer`.
- HTTP smoke production: anonymous `/` -> `200` с оболочкой входа, webhook/worker без секрета `401`, manifest и service worker `200`; отдельная fail-closed проверка без `RITM_OWNER_USER_ID` дала `307` на `/login?reason=not-configured`.
- Production `/` визуально открыт во встроенном браузере: показана публичная оболочка входа без приватного журнала. Обновлена Playwright-конфигурация на прямой Next dev server и порт `3002`; локальный e2e WebKit подтвердил оба API-теста, а UI-тест не стартовал из-за Windows `spawn EPERM` при запуске Playwright WebKit.
- Тот же access smoke в установленном Chrome через `PLAYWRIGHT_CHANNEL=chrome`: **3 passed** (redirect на login, webhook без cookie и worker с серверным секретом).
- Локальный Chrome demo smoke на viewport `390×844`: выбор шаблона → отдельная активная сессия → фактические `8` повторов → запись подхода → автоматический отдых → пропуск отдыха → следующий подход. Demo-данные не были production-аккаунтом и не синхронизировались.
- WebKit установлен и headless запуск подтвержден.
- Timer helper: version 1 -> reschedule version 2 (+30) -> cancel version 3.
- Outbox acknowledgement после успешного command request сохраняется в отдельном user-scoped localStorage ключе; основной sync payload не изменяется.
- Sync recovery: тестовое решение lost PUT response покрывает `accepted` при совпавшем payload и новой ревизии, `retry` при прежней ревизии и `conflict` при чужой новой версии; UI показывает offline/error и даёт ручной retry.
- Начальный sync сохраняет базовый локальный снимок до GET и не объявляет локальное действие, сделанное во время GET, конфликтом, если сервер всё ещё содержит этот базовый снимок.
- При пустом remote payload локальное состояние со статусом `loaded` отправляется после получения server revision.
- Добавлен тест изоляции ack между пользователями и сохранения ack после reload.
- User-scoped storage больше не подхватывает глобальную legacy-запись автоматически; добавлен регрессионный тест. Старые данные сохраняются и предлагаются для явного переноса в авторизованных настройках.

## Production и Telegram

- Production URL: `https://ritm-tracker.vercel.app/`.
- Подтверждённый production deployment для `dc4109a`: `dpl_HG6iWBoZUcXVeWozgLRsHcuHgjV2` (READY), alias `https://ritm-tracker.vercel.app/`.
- Production smoke после deployment: `/` -> `200` с оболочкой входа, `/manifest.webmanifest` -> `200`, `/sw.js` -> `200`, webhook GET -> `405` (маршрут доступен и принимает только POST).
- После `dpl_BB8YNyXgpWgfuqxX1wC4kG8Qmw9U` повторно проверены login shell, manifest и service worker; Vercel runtime errors за 15 минут после публикации: отсутствуют.
- Vercel Production variables присутствуют; production `/` показывает обычный вход без `reason=not-configured`.
- Supabase project `wlaojddckdebbeqafbbg`: миграции `persistent_telegram_links` и `workout_timer_commands` применены; timer RPC доступен `authenticated`, недоступен `anon`, прямые INSERT в служебные `commands` и `notification_jobs` для `authenticated` запрещены.
- Telegram `getMe` подтверждает `@solonflowai_treker_bot`.
- `getWebhookInfo`: webhook установлен на production, `pending_update_count=0`, `last_error=null`.
- Реальная привязка Telegram проверена по сообщению пользователя: deep-link `/start <token>` получил ответ «Telegram подключен к Ритму.»
- Повторная генерация ссылки теперь обновляет `token_expires_at`; webhook проверяет срок токена, а не срок постоянного подключения.
- Worker записывает сетевую неопределённость Telegram как `unknown`, проверяет результат финализации job и не объявляет очередь обработанной при ошибке записи.
- Telegram rest callbacks (`+30 секунд` / `Пропустить`) реализованы через server-side RPC `accept_telegram_timer_command`; RPC применена в Supabase, доступна только `service_role`, `anon` не имеет execute.
- Supabase migrations `telegram_timer_callbacks` (`20260911111446`) и `telegram_timer_callback_versions` (`20260911112710`) применены; последовательные `+30 секунд` получают новые source versions. Cron job `ritm-telegram-worker-every-10-seconds` активен с интервалом 10 секунд, последние вызовы worker: HTTP `200`, `processed: 0`.
- Миграция `harden_function_search_paths` (`20260911114942`) применена; `public.set_updated_at` и `public.match_documents` теперь имеют фиксированный `search_path`. Повторный security advisor больше не показывает `function_search_path_mutable`.
- Webhook fail-closed проверяет наличие `TELEGRAM_BOT_TOKEN` до обработки update и callback.
- На собранном Next с Supabase URL/key, но без `RITM_OWNER_USER_ID`, приватный `/` проверен через HTTP: `307` на `/login?reason=not-configured`.
- При обнаружении revision-конфликта UI предлагает оставить локальную или серверную копию; обе версии сначала сохраняются в user-scoped резервные записи, а выбор локальной копии выполняет повторный owner-scoped PUT с актуальной revision. Фактический сценарий на двух устройствах пока не запускался.
- Раздел прогресса сохраняет приватные дневные наблюдения (сон, энергия, самочувствие, заметка) и поддерживает JSON-экспорт user-scoped состояния.
- Раздел прогресса также поддерживает user-scoped галерею фото до 5 МБ на файл с удалением и включением в JSON-экспорт; это приватное состояние приложения, не отдельное Supabase Storage.
- Новый аккаунт получает только шаблон программы: фактическая тренировка появляется в истории после явного старта сессии; добавлен регрессионный тест этого разделения.
- В приватных настройках владелец может менять название каждого события, расписание и собственное название; `/settings` production проверен как закрытый маршрут.
- Outbox-команды имеют видимые статусы `sending`, `accepted` и `failed`; при ошибке запись остаётся локально и показывается пользователю для автоматического повтора.

## Не проверено и не объявляется готовым

- Реальная отправка production job в Telegram — **НЕ ПРОВЕРЕНО**: pending job не создавался, чтобы не отправлять пользователю искусственное тестовое сообщение.
- Реальные callback update и `answerCallbackQuery` в Telegram — **НЕ ПРОВЕРЕНО**: production job с кнопками намеренно не создавался.
- Production `+30` с заменой dueAt и production cancel — **НЕ ПРОВЕРЕНО**.
- `pg_cron`, `pg_net` и `supabase_vault` включены; job `ritm-telegram-worker-every-10-seconds` активен. После последнего redeploy вызовы worker получили HTTP `200` и `processed: 0`; активная Telegram-привязка существует, pending jobs нет.
- Два устройства/два аккаунта и полноценное conflict resolution — **НЕ ПРОВЕРЕНО**.
- Явный перенос legacy storage реализован, но на production не подтверждался на реальном аккаунте, чтобы не менять личный журнал.
- Bundled Chromium/WebKit Playwright в Windows остаются ограничены `spawn EPERM`; установленный Chrome через `PLAYWRIGHT_CHANNEL=chrome` прошёл полный access smoke 3/3.
- Полный iPhone offline/background/lock-screen сценарий — **НЕ ПРОВЕРЕНО**.
- RLS для посторонней таблицы `public.RAGformyAIagent` не менялся; её назначение и корректные политики не подтверждены.
- Supabase security advisor всё ещё сообщает об отключённой leaked-password protection, RLS/GraphQL exposure для посторонней `public.RAGformyAIagent` и public `vector` extension; эти настройки требуют отдельного решения владельца проекта и намеренно не менялись автоматически.

## Ограничения теста

Production account использовался read-only. Реальная тестовая тренировка и job не создавались, чтобы не добавлять лишнюю запись в личный журнал.
