# TEST_REPORT

Дата: 2026-09-09

## Реализовано

- PWA `Ритм` с дневными привычками, тренировкой, таймером и локальным outbox.
- Безопасная гидрация `ritm-tracker-state-v1`: поврежденный JSON резервируется и не перезаписывается начальным состоянием.
- Локальная дата `Europe/Moscow`, четыре рабочих подхода, per-hand учет, составные махи, идемпотентная команда `completeWorkoutSet` и автотаймер 240/180 секунд.
- Импорт с inline-упражнениями, десятичной запятой, неизвестными повторами и стабильным ID после нормализации пробелов.
- Перенесенный аудит регрессий, Supabase migration/RLS/RPC каркас и Telegram webhook с секретом, валидацией и durable `telegram_updates` journal.
- Закрытый owner-gated вход через Supabase, fail-closed middleware в `src/middleware.ts`, user-scoped localStorage и `/api/sync`.
- Настройка действий дня и шаблона тренировки: названия, расписания, упражнения, отдых и количество подходов.
- Явный выбор режима веса в рабочем подходе, отказ от молчаливого учета неизвестного режима и выход из аккаунта с сохранением локальной очереди.

## Проверено локально

```bash
node --test --experimental-strip-types tests\\tracker.test.ts tests\\repair.test.ts tests\\telegram.test.ts tests\\audit-regressions.test.mjs
```

Результат: 36 тестов, 36 passed.

```bash
.\\node_modules\\.bin\\tsc --noEmit
.\\node_modules\\.bin\\eslint "src/**/*.{ts,tsx}" "tests/**/*.ts"
.\\node_modules\\.bin\\next build
```

Все три проверки прошли.

```bash
.\node_modules\.bin\playwright test --project=chromium
```

Результат: 2 теста, 2 passed. Проверены redirect приватной страницы без конфигурации и отсутствие browser-login redirect у webhook. Chromium запускался с разрешением Windows после sandbox `spawn EPERM`.

Production build подтвердил middleware manifest с `name: "src/middleware"` и маршрутами `/api/sync`, `/api/telegram/webhook`, `/api/telegram/worker`.

Проверены отдельно: МСК после полуночи, расчет веса на руку, явный общий вес, неизвестный режим как unscored, четыре рабочих подхода, две пары составных плеч с одним отдыхом на пару, двойное подтверждение, автотаймер, пустой и исторический импорт, batch parser, невозможные числовые и русские даты, дубликаты, user-scoped storage, offline JS fallback, резервирование поврежденного storage, secret/update_id Telegram validation.

## Написано, но не проверено внешними сервисами

- Supabase migrations `ritm_core`, security hardening, `tracker_state`, `telegram_updates` и server-only lease/retry RPC для `notification_jobs` применены к проекту; реальный RPC/изоляция двумя учетными записями еще не прогонялись.
- Production login и webhook secret проверены на реальном Vercel deployment. Реальная доставка Telegram и callback ownership еще не прогонялись; повторная запись `update_id` защищена в route и уникальным ключом БД, но внешний production smoke-test дедупликации еще не выполнен.

## Не завершено

- Полный Auth/Storage client для relational journal, транзакционная sync и интеграционные тесты с двумя пользователями.
- Telegram callback actions, создание due jobs из фактов тренировки и реальный smoke-test отправки уведомления; worker/lease/retry код уже написан.
- IndexedDB command log, конфликты вкладок/устройств и восстановление после offline.
- Полный дневной сценарий, наблюдения, фото, экспорт/восстановление и полноценные графики.
- Playwright E2E всех пользовательских действий, iPhone и блокировка экрана.
