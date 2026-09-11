# Ритм: план и статус

Проверяемый кодовый commit: `b36e352` (`fix: make Telegram rest timers durable`).

## Закрыто в этом проходе

- Добавлена единая команда timer `reschedule/cancel` через owner-scoped API и Supabase RPC.
- `+30 секунд` повышает `sourceVersion`, сохраняет локальное состояние и ставит серверную замену job.
- «Пропустить отдых» сохраняет cancel-команду; старые jobs отменяются RPC.
- Подтвержденная Telegram-привязка больше не зависит от истечения одноразовой ссылки; добавлены `token_expires_at`, `connected_at`, `revoked_at`.
- Добавлен CI для `pnpm install --frozen-lockfile`, тестов, lint, typecheck и production build.
- В `package.json` закреплен `packageManager: pnpm@9.15.0`.
- Добавлены unit-проверки версионированного reschedule/cancel таймера.

## Уже было закрыто

- Fail-closed middleware и user-scoped local storage.
- Раздельные template/session/history, фактические подходы, составные плечи и идемпотентные команды.
- Десятичная запятая, импорт исторических дат, резервирование поврежденного storage, stable JSON и revision sync basis.
- PWA shell, service worker, mobile navigation, weight editor с focus trap и возвратом фокуса.

## Открытые блокеры

- Новые Supabase migrations не применены автоматически: нет доступного Supabase CLI/project ref или server credentials.
- Реальный pg_cron/pg_net/Vault scheduler не подтвержден.
- Потерянный PUT response и полноценные sync-состояния требуют отдельной state-machine и UI разрешения конфликта.
- Outbox acknowledgement нужно довести до явных `pending/sending/accepted/failed/cancelled` переходов.
- Два устройства, два аккаунта, реальная job -> worker -> Telegram доставка, reschedule и cancel в production не объявляются проверенными.
- Полный SPEC по сну, фото, экспорту, check-in, postpone/skip и аналитике остаётся незавершенным.
