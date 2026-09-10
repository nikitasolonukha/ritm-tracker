# TEST_REPORT

Дата: 2026-09-10

Проверяемый коммит: рабочее дерево после `e27030b` (UI pack iteration, commit pending).

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
- Отдельные страницы `/today`, `/workouts`, `/workouts/templates/[templateId]`, `/workout/[sessionId]`, `/workout/[sessionId]/summary`, `/journal`, `/progress` и `/settings`.
- Активная сессия с общим таймером, текущим упражнением, сохраненным весом/режимом, фактическими повторениями, отдыхом, явным переходом к следующему упражнению и итогом в истории.
- `/` перенаправляет в новый `/today`; быстрые действия дня сохраняются и отменяются идемпотентно. `/settings` редактирует первый приватный шаблон: название, упражнения, рабочий вес, повторы и отдых.
- Общий `TrackerProvider` подключён в корневом layout; новые страницы используют один account-scoped store, локальное сохранение и revision sync queue. Pending set commands передаются в owner-scoped `/api/workout/command` и notification job RPC.
- Premium UI pack applied to the existing routes: graphite/lime tokens, four-item mobile navigation, desktop sidebar, week capsules, Today hero/action list/weekly goal, focused active-set layout, +/- reps controls, set segments, weight editor and rest progress/actions. The record action now rejects empty reps instead of silently recording the plan. The weight editor can update the current snapshot and optionally remember the value in the template.

## Проверено локально

```bash
node --test --experimental-strip-types tests\\tracker.test.ts tests\\repair.test.ts tests\\telegram.test.ts tests\\audit-regressions.test.mjs
```

Результат: 40 тестов, 40 passed.

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

Production build подтвердил middleware manifest с `name: "src/middleware"` и маршрутами `/api/sync`, `/api/workout/command`, `/api/telegram/link`, `/api/telegram/webhook`, `/api/telegram/worker`.

Ручной браузерный smoke-test на локальном dev-сервере с явно включенным `RITM_DEMO_MODE=1`: `/` -> `/today`, отметка действия -> изменение веса 45 -> 50 в `/settings` -> новый старт использует 50 -> ввод повторений -> запись подхода -> отдых с подписью `Следующий подход 2 из 4`. Viewport 390x844 и 1440x1000 проверены; PNG сохранены локально вне Git (`artifacts-workout-390-active.png`, `artifacts-workout-1440-active.png`, `artifacts-workout-390-rest.png`).

UI pack browser evidence was rendered from a separate synthetic local state (no personal data) on the local dev server: Today, program preview, active set, weight editor, rest, summary and journal at 390 px, plus Today and active set at 1440 px. Files are in `artifacts/ui-review/`.

Screenshot files:

- `artifacts/ui-review/today-390.png`
- `artifacts/ui-review/program-390.png`
- `artifacts/ui-review/active-set-390.png`
- `artifacts/ui-review/rest-390.png`
- `artifacts/ui-review/weight-editor-390.png`
- `artifacts/ui-review/summary-390.png`
- `artifacts/ui-review/journal-390.png`
- `artifacts/ui-review/today-1440.png`
- `artifacts/ui-review/active-set-1440.png`

The headless browser required the Windows execution approval (`spawn EPERM` in the sandbox); the resulting screenshots were opened and visually checked for clipping and responsive layout.

Проверены отдельно: МСК после полуночи, расчет веса на руку, явный общий вес, неизвестный режим как unscored, четыре рабочих подхода, две пары составных плеч с одним отдыхом на пару, untouched/empty/valid/invalid drafts, stable JSON comparison, двойное подтверждение, автотаймер, пустой и исторический импорт, batch parser, невозможные числовые и русские даты, дубликаты, user-scoped storage, offline JS fallback, резервирование поврежденного storage, secret/update_id Telegram validation.

## Написано, но не проверено внешними сервисами

- Supabase migrations `ritm_core`, security hardening, `tracker_state`, `telegram_updates`, server-only lease/retry RPC для `notification_jobs` и atomic `save_tracker_state` revision RPC применены к проекту; реальная двухустройственная RPC/изоляция двумя учетными записями еще не прогонялась.
- Production login, webhook secret и worker secret проверены на реальном Vercel deployment. Реальная доставка Telegram и callback ownership еще не прогонялись; webhook-дедупликация `update_id` уже проверена внешним smoke-test, worker проверен на отказ при неверном секрете.

## Не завершено

- Полный Auth/Storage client для relational journal, связывание snapshot с relational фактами и живые интеграционные тесты двух устройств/двух пользователей.
- UI разрешения конфликта с безопасным merge/export; текущая версия сохраняет обе стороны и приостанавливает отправку до явного разрешения.
- Telegram callback actions, создание due jobs из фактов тренировки и реальный smoke-test отправки уведомления; worker/lease/retry и одноразовая привязка уже написаны.
- IndexedDB command log, конфликты вкладок/устройств и восстановление после offline.
- Полный дневной сценарий, наблюдения, фото, экспорт/восстановление и полноценные графики.
- Playwright E2E всех пользовательских действий, iPhone и блокировка экрана.
- The current UI screenshot smoke path uses synthetic local state; it does not prove the same visual states with a real authenticated account or real Telegram delivery.
- Автоматические тесты двух вкладок/двух устройств и UI разрешения конфликта ещё не закрыты; текущий store сохраняет локальную копию и останавливает server queue при 409.
- Реальная отправка Telegram по новому job не проверялась в тестовом чате; RPC/миграция применены к Supabase-проекту и проверены наличием функции/колонки, но end-to-end delivery не запускалась.
- Supabase security advisor после hardening всё ещё сообщает существующую постороннюю `public.RAGformyAIagent` без RLS, отсутствие policy у `telegram_updates`, mutable search path у `set_updated_at`/`match_documents`, public vector extension и отключённую leaked-password protection. Эти внешние предупреждения не скрыты и не изменялись автоматически.
