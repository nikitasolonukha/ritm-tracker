# Ритм: план и статус

Проверяемый кодовый commit: `c213e55` (`fix: keep starter workout out of history`).

## Закрыто в этом проходе

- Добавлена единая команда timer `reschedule/cancel` через owner-scoped API и Supabase RPC.
- `+30 секунд` повышает `sourceVersion`, сохраняет локальное состояние и ставит серверную замену job.
- «Пропустить отдых» сохраняет cancel-команду; старые jobs отменяются RPC.
- Подтвержденная Telegram-привязка больше не зависит от истечения одноразовой ссылки; добавлены `token_expires_at`, `connected_at`, `revoked_at`.
- Добавлен CI для `pnpm install --frozen-lockfile`, тестов, lint, typecheck и production build.
- В `package.json` закреплен `packageManager: pnpm@9.15.0`.
- Добавлены unit-проверки версионированного reschedule/cancel таймера.
- Добавлены приватные user-scoped фото прогресса до 5 МБ на файл, удаление и JSON-экспорт.
- Для серверных функций `set_updated_at` и `match_documents` зафиксирован `search_path`; миграция применена в Supabase.
- Стартовый шаблон отделён от фактической истории: новая сессия появляется только после явного действия владельца.

## Уже было закрыто

- Fail-closed middleware и user-scoped local storage.
- Раздельные template/session/history, фактические подходы, составные плечи и идемпотентные команды.
- Десятичная запятая, импорт исторических дат, резервирование поврежденного storage, stable JSON и revision sync basis.
- PWA shell, service worker, mobile navigation, weight editor с focus trap и возвратом фокуса.

## Открытые блокеры

- Миграции `persistent_telegram_links` и `workout_timer_commands` применены в Supabase project `wlaojddckdebbeqafbbg`; наличие RPC, права `authenticated` и запрет `anon` проверены SQL-запросом.
- В Supabase остаётся отдельная посторонняя таблица `public.RAGformyAIagent` без RLS; автоматически включать RLS нельзя без понимания её владельца и политик.
- Supabase `pg_cron`/`pg_net`/Vault scheduler включён: job `ritm-telegram-worker-every-10-seconds` активен, worker отвечает `200`.
- Security advisor больше не показывает mutable `search_path`; остаются внешние настройки Supabase для `RAGformyAIagent`, public `vector` и leaked-password protection.
- Потерянный PUT response и полноценные sync-состояния требуют отдельной state-machine и UI разрешения конфликта.
- Outbox acknowledgement теперь сохраняется отдельным user-scoped durable индексом; сетевой сбой не записывается как успех, а повтор использует стабильный command key. Явный UI для `sending/failed` остаётся отдельной задачей.
- Два устройства, два аккаунта и реальная job -> Telegram отправка с pending job остаются непроверенными; scheduler transport уже подтверждён. UI разрешения revision-конфликта написан, но two-device acceptance ещё не запускался.
- Автоматический fallback user-scoped storage на глобальную legacy-запись удалён; явный перенос старых данных доступен из авторизованных настроек.
- Приватная локальная галерея фото, базовая дневная отметка, сон и JSON-экспорт реализованы. Отдельное удалённое хранилище фото, check-in/postpone и расширенная аналитика остаются незавершенными.
