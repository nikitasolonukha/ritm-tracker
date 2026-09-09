# TEST_REPORT

Дата: 2026-09-09

## Реализовано

- PWA `Ритм` с дневными привычками, тренировкой, таймером и локальным outbox.
- Безопасная гидрация `ritm-tracker-state-v1`: поврежденный JSON резервируется и не перезаписывается начальным состоянием.
- Локальная дата `Europe/Moscow`, четыре рабочих подхода, per-hand учет, составные махи, идемпотентная команда `completeWorkoutSet` и автотаймер 240/180 секунд.
- Импорт с inline-упражнениями, десятичной запятой, неизвестными повторами и стабильным ID после нормализации пробелов.
- Перенесенный аудит регрессий, Supabase migration/RLS/RPC каркас и Telegram webhook validation route.

## Проверено локально

```bash
node --test --experimental-strip-types tests\\tracker.test.ts tests\\repair.test.ts tests\\telegram.test.ts tests\\audit-regressions.test.mjs
```

Результат: 33 теста, 33 passed.

```bash
.\\node_modules\\.bin\\tsc --noEmit
.\\node_modules\\.bin\\eslint "src/**/*.{ts,tsx}" "tests/**/*.ts"
.\\node_modules\\.bin\\next build
```

Все три проверки прошли. E2E smoke test ранее проходил на desktop `1440x1000` и mobile `390x844`; после текущих изменений требуется повторный визуальный прогон.

Проверены отдельно: МСК после полуночи, расчет веса на руку, четыре рабочих подхода, двойное подтверждение, автотаймер, пустой и исторический импорт, дубликаты, offline JS fallback, резервирование поврежденного storage, secret/update_id Telegram validation.

## Написано, но не проверено внешними сервисами

- Supabase migration, RLS policies и owner-scoped RPC: статически просмотрены и покрыты контрактными тестами, но реальный проект Supabase не подключен.
- Telegram webhook route: проверяется секрет и формат update; реальная доставка, callback ownership и дедупликация в БД еще не прогонялись.

## Не завершено

- Реальный Auth/Storage client, транзакционная sync и интеграционные тесты с двумя пользователями.
- Полная Telegram очередь due/lease/retry, worker и регистрация webhook.
- IndexedDB command log, конфликты вкладок/устройств и восстановление после offline.
- Полный дневной сценарий, наблюдения, фото, экспорт/восстановление и полноценные графики.
- Playwright E2E всех пользовательских действий, iPhone и блокировка экрана.
