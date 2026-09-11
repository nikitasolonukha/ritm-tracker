# Ритм: план и статус

Проверяемый кодовый commit: `bb807ab` (`fix: recover sync after lost put responses`).

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
- Добавлена приватная настройка названий и расписаний событий дня.
- Outbox получил явные статусы отправки/успеха/ошибки и видимый индикатор в навигации.
- Основной активный workout flow проверен в локальном Chrome demo на мобильном viewport, включая отдых и переход к следующему подходу.
- Sync state machine получила состояния `loading/dirty/syncing/offline/conflict/error`, восстановление по `online/visibilitychange` и ручной retry.
- Потерянный ответ PUT теперь сначала сверяется GET с отправленным payload; повтор выполняется только при неизменной серверной ревизии, добавлен регрессионный тест.
- Начальный sync сравнивает сервер с базовым снимком до локального действия, поэтому быстрый ввод во время GET не превращается в ложный conflict.

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
- Потерянный PUT response обрабатывается через GET/reconcile: одинаковый серверный payload принимается, прежняя ревизия повторяется, другая версия переводит UI в conflict; acceptance на двух устройствах ещё не запускался.
- Outbox acknowledgement сохраняется отдельным user-scoped durable индексом; сетевой сбой не записывается как успех, повтор использует стабильный command key, а UI показывает `sending/failed`.
- Два устройства, два аккаунта и реальная job -> Telegram отправка с pending job остаются непроверенными; scheduler transport уже подтверждён. UI разрешения revision-конфликта написан, но two-device acceptance ещё не запускался.
- Автоматический fallback user-scoped storage на глобальную legacy-запись удалён; явный перенос старых данных доступен из авторизованных настроек.
- Приватная локальная галерея фото, базовая дневная отметка, сон и JSON-экспорт реализованы. Отдельное удалённое хранилище фото, check-in/postpone и расширенная аналитика остаются незавершенными.
