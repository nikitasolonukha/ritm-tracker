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
- Одноразовая Telegram-ссылка из настроек, hash-only хранение токена, подтверждение `/start` только для незарегистрированного и неистекшего токена.

## Проверено локально

```bash
node --test --experimental-strip-types tests\\tracker.test.ts tests\\repair.test.ts tests\\telegram.test.ts tests\\audit-regressions.test.mjs
```

Результат: 37 тестов, 37 passed.

```bash
.\\node_modules\\.bin\\tsc --noEmit
.\\node_modules\\.bin\\eslint "src/**/*.{ts,tsx}" "tests/**/*.ts"
.\\node_modules\\.bin\\next build
```

Все три проверки прошли.

```bash
.\node_modules\.bin\playwright test --project=chromium
```

Результат: 3 теста, 3 passed. Проверены redirect приватной страницы без конфигурации, отсутствие browser-login redirect у webhook и отдельная защита worker. Chromium запускался с разрешением Windows после sandbox `spawn EPERM`.

Production build подтвердил middleware manifest с `name: "src/middleware"` и маршрутами `/api/sync`, `/api/telegram/link`, `/api/telegram/webhook`, `/api/telegram/worker`.

Проверены отдельно: МСК после полуночи, расчет веса на руку, явный общий вес, неизвестный режим как unscored, четыре рабочих подхода, две пары составных плеч с одним отдыхом на пару, двойное подтверждение, автотаймер, пустой и исторический импорт, batch parser, невозможные числовые и русские даты, дубликаты, user-scoped storage, offline JS fallback, резервирование поврежденного storage, secret/update_id Telegram validation.

## Написано, но не проверено внешними сервисами

- Supabase migrations `ritm_core`, security hardening, `tracker_state`, `telegram_updates`, server-only lease/retry RPC для `notification_jobs` и atomic `save_tracker_state` revision RPC применены к проекту; реальная двухустройственная RPC/изоляция двумя учетными записями еще не прогонялась.
- Production login, webhook secret и worker secret проверены на реальном Vercel deployment. Реальная доставка Telegram и callback ownership еще не прогонялись; webhook-дедупликация `update_id` уже проверена внешним smoke-test, worker проверен на отказ при неверном секрете.

## Не завершено

- Полный Auth/Storage client для relational journal, связывание snapshot с relational фактами и интеграционные тесты двух устройств/двух пользователей.
- Telegram callback actions, создание due jobs из фактов тренировки и реальный smoke-test отправки уведомления; worker/lease/retry и одноразовая привязка уже написаны.
- IndexedDB command log, конфликты вкладок/устройств и восстановление после offline.
- Полный дневной сценарий, наблюдения, фото, экспорт/восстановление и полноценные графики.
- Playwright E2E всех пользовательских действий, iPhone и блокировка экрана.
