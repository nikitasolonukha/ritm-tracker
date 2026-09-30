# TEST_REPORT

## Текущий проход: 2026-09-30

Дата прохода указана в `Europe/Moscow`. Базовый HEAD: `b8128a2794addf96650416874559482d67e87430`. **Проверенный и развёрнутый runtime: `2f25c372f8beba88e053637b54a488bd2a0e4da9`.** Последующий коммит отчёта, браузерных тестов и снимков не меняет runtime-файлы.

Ниже разделены написанный код, локальные проверки и подтверждения реального сервиса. Runtime развёрнут на `https://ritm-tracker.vercel.app`. Готовность к продаже не подтверждена. Все результаты после границы исторического отчёта относятся только к прежним датам и ревизиям.

### Написано (written)

Текущее описание возможностей: [README](../README.md). Наличие реализации не означает успешный browser QA или production-проверку.

- Email/password вход и серверная регистрация активного аккаунта без письма подтверждения; проверка пользователя middleware через `getUser`, RLS и отдельные локальные ключи аккаунтов. Личные credentials и программы не входят в defaults; demo включается явно только локально.
- Настройка программ, упражнений, фактических подходов, весов, оборудования и отдыха. Старт создаёт независимый снимок программы и уникальную сессию. Подтверждённый подход сохраняется до отображения успеха и запуска отдыха; команда и уведомление записываются серверной транзакцией. Плановые подходы не считаются выполненными. Частичное завершение, отмена и исправление истории не изменяют шаблон; исправление истории не создаёт таймеров.
- Привычки с днями недели, временем или привязкой к событию, отметкой, пропуском, отменой, архивом и ограниченным откладыванием. События сна и дневные наблюдения; текстовый импорт тренировок с уточнением года, предпросмотром, исправлением и подтверждением.
- JSON-восстановление добавляет записи с сохранением существующих значений, активной сессии и очереди. Синхронизация сравнивает локальную копию, базовый снимок и серверную ревизию, резервирует обе стороны конфликта и сверяет потерянный ответ PUT через GET. До PUT сохраняется account-scoped намерение отправки; после reload подтверждённая сервером копия восстанавливает checkpoint, не заменяя более новый локальный черновик. Поздний ACK прежнего аккаунта не записывается в другой аккаунт.
- Приватные фото в собственном каталоге Storage `progress-photos`; JPG/PNG/WebP до 5 МБ, JSON-экспорт с изображениями до 20 МБ. Удаление из галереи убирает метаданные; физический объект сохраняется в Storage.
- PWA разделяет публичный кеш и HTML аккаунта по проверенному сервером ID; Auth/API/redirect и внешние приватные фото исключены из общего fallback. Активный маршрут сохраняется для offline reload, история и outbox сохраняются при обновлении service worker.
- Telegram webhook с secret header, одноразовой привязкой и устойчивыми receipts `update_id`; worker с версиями источника, арендой с токеном, отменой, сроком годности, ограниченными повторами, `429/retry_after` и отдельным неопределённым результатом. Повторная доставка при неопределённости возможна.

### Локально проверено (locally verified)

- Сегодня повторно проверен актуальный код: Node tests **148/148 passed, 0 failed**; прямые запуски TypeScript (`tsc --noEmit`) и ESLint: **passed**. Node coverage измеренного набора: строки 98.40%, ветки 88.40%, функции 91.14%; это не coverage всех React-экранов.
- Реальная configured stage production-сборка на **Next.js 15.5.25: passed**. Manifest содержит `src/middleware`; HTTP smoke закрытых страниц без авторизации: **307**, закрытых API: **401**. Это локальная production-сборка, не deployment production runtime.
- Реальная unconfigured production-сборка: **passed**. HTTP fail-closed: `/api/sync` **503**, `/today` **307** с `reason=not-configured`, `/login` **200** с безопасным состоянием, не приватным интерфейсом.
- На свежем локальном Postgres прошла **полная цепочка миграций**, проверки **двух реальных RLS-идентичностей**, composite FK и RPC, **50 регрессий привычек**, транзакция **timer snapshot**. Это SQL-проверки изолированной локальной базы; они не подтверждают browser QA Supabase Auth/Storage.
- Chromium на запущенном production Next и настоящей локальной Supabase Auth/Storage: **два последовательных полных прогона passed (1.4 и 1.9 минуты), в каждом 14/14 фаз, 0 функциональных и визуальных падений**. Это не demo и не API-моки. Использованы только две выделенные локальные QA-учётки.
- Повторный прогон прежнего runtime `e242c79` воспроизвёл ложный конфликт после abort PUT, уже сохранённого сервером. В `11665f3` добавлена надёжная запись намерения до отправки. Новый браузерный тест пропускает cancel PUT на реальный сервер, проверяет HTTP 200 и новую ревизию, но удерживает ответ до offline reload. Черновик `9`, второй подход и дальнейшая сессия синхронизируются без конфликта. Assertions не удалены; отдельные тесты запрещают принятие чужого/неподтверждённого snapshot и проверяют quota/error/изоляцию намерений.
- Review выявил межвкладочную гонку общей записи намерения; в `2f25c37` страница подтверждает только захваченное при загрузке или отправленное ею намерение. Удаление условное, по точному совпадению. В обоих финальных браузерных прогонах настоящая вкладка B сохраняет наблюдение с удержанным ответом PUT; чистая A загружает его без собственного PUT, ревизия и запись B не меняются, намерение B сохраняется. Это проверка данной гонки, не доказательство произвольного автоматического объединения нескольких dirty-вкладок.
- Пройдено: guest -> login -> SW до/после входа; защита формы без JavaScript и до hydration; дробный ввод; новая программа -> четыре фактических подхода -> отдых/+30/skip -> завершение -> исправление истории -> второй браузер; привычки/архив/повторы; импорт нескольких дат; PNG в приватном Storage; полный JSON-export/preview/restore; offline reload активного отдыха и черновика; offline отметка и отправка очереди после восстановления сети; два аккаунта и сохранение чужого legacy-маркера без доступа к нему.
- Команды и уведомления прочитаны из настоящей локальной БД: по одному future job на подтверждённый подход, правильные сроки и версия, стабильный command ID при повторном ACK, неизменная ревизия при ACK. Браузерной роли доступ к служебной очереди не открывался.
- Проверены ширины **375/390/430/1440 px**. 39 свежих снимков с вымышленными QA-данными: `artifacts/product-qa/`. Основные пары: `active-workout`, `rest-timer`, `persistent-rest-settings`, `workout-summary`, `workout-history` с суффиксами `-390.png` и `-1440.png`.
- WebKit полный прогон финального runtime **failed**: 9 фаз подтверждены, три сбоя (ожидание PUT из соседней вкладки в program phase, offline reload активной тренировки, offline reload дня), зависимые история/backup не проверены. Наблюдение и настоящий private PNG Storage в последнем полном прогоне passed. Есть uncaught access-control errors при сетевом перехвате; зелёным этот прогон не объявляется.
- Отдельный WebKit без request interception на `2f25c37`: поля `7`/`7,5` вводятся без дублирования, **наблюдение сохраняется в настоящей локальной Supabase и восстанавливается после reload**. При переходах зарегистрированы два access-control errors от запросов фото; эта проверка не означает отсутствие всех ошибок WebKit. При `setOffline(true)` reload падает; контроль с остановкой собственного QA-origin на той же текущей сборке возвращает страницу из настоящего SW-кеша (`fromServiceWorker=true`). Это контроль недоступности сервера, не замена проверки полного отключения сети/iPhone. Ошибка эмуляции соответствует [Playwright #42775](https://github.com/microsoft/playwright/issues/42775).

Команды для воспроизведения из корня проекта на Node.js 22 с установленными зависимостями:

```powershell
node --test --experimental-strip-types tests/tracker.test.ts tests/repair.test.ts tests/telegram.test.ts tests/audit-regressions.test.mjs tests/workout-session.test.ts tests/product.test.ts tests/auth-product.test.ts tests/backup.test.ts tests/telegram-runtime.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js "src/**/*.{ts,tsx}" "tests/**/*.ts"
node node_modules/next/dist/bin/next build
$env:PRODUCT_QA_URL = 'http://localhost:3005'
node node_modules/@playwright/test/cli.js test --config=tests/e2e/product.config.ts
```

Production-сборка запускается с конфигурацией проверяемого окружения; configured и unconfigured результаты выше относятся к отдельным запускам.
Для browser QA заранее запускается локальная сборка с локальной Supabase. В процесс теста передаются только локальные `NEXT_PUBLIC_SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` для серверной проверки очереди; они не входят в Git. `PRODUCT_QA_BROWSER=webkit` запускает отдельный не прошедший полный прогон, без ослабления assertions. Trace и ошибки остаются в игнорируемой `.private`.

### Проверено на реальном сервисе (real service verified)

Перед применением сохранена приватная резервная копия production. В production Supabase применены четыре миграции:

- `20260930161045_multi_account_product`.
- `20260930164401_habit_snooze_and_repeat_guard`.
- `20260930170804_habit_notification_regressions`.
- `20260930171808_telegram_timer_snapshot`.

Проверены права EXECUTE для rest callback, habit callback и planner: **`anon = false`, `authenticated = false`, `service_role = true`**. Применение миграций и проверка прав не подтверждают deployment приложения или доставку нового Telegram-пути.

Чтением SQL в production подтверждено: cron job `ritm-telegram-worker-every-10-seconds` активен, интервал **10 секунд**. Эта проверка подтверждает состояние расписания; доставка Telegram новым путём не проверена.
- Vercel: deployment `dpl_9CwiKrAQsP1CcCfXCumK62P49FV1` **READY**, runtime экспортирован из Git allowlist. Секреты, `.env.local`, `.private`, fixtures и screenshots не загружались. Основной адрес переключён через `vercel promote` после успешного Chromium QA; метаданные deployment подтверждают SHA `2f25c37`, повторный полный прогон также passed.
- На основном адресе: неизвестный посетитель `/today` -> **307**, `/api/sync` -> **401**, webhook/worker без секрета -> **401**, не redirect на login.
- Реальный вход существующего аккаунта в браузере -> `/settings`; приватный snapshot читается, server-owned legacy import разрешён только владельцу. Все фоновые записи журнала в этом smoke были заблокированы; сравнение payload до/после подтверждает отсутствие изменений личного журнала.
- Telegram текущего аккаунта: **expired**, подтверждённой привязки нет. Диагностический job не создавался и сообщение не отправлялось. Привязка прежнего аккаунта не переносилась SQL вручную; требуется одноразовый `/start` из нужного Telegram-аккаунта.

### Не проверено (not verified)

- Полный WebKit-путь после устранения/обхода ограничений test runner остаётся незакрытым. Отдельное серверное сохранение наблюдения проверено без перехвата запросов; это не закрывает неуспешный полный прогон с interception и offline emulation.
- Создание новой учётки в production не выполнялось ради теста. Регистрация без письма подтверждена на настоящем локальном GoTrue, не на рабочем сервисе.
- Реальные привязка, доставка, rest/habit callbacks и синхронизация снимка через новый Telegram-путь не подтверждены. Старые сообщения и scheduler-проверки из исторического отчёта не подтверждают новый путь.
- iPhone Safari, включая offline/reconnect, фон, блокировку экрана и уведомления, не тестировался в этом проходе. Локальный desktop browser или мобильный viewport не заменяют физический iPhone.

### Не завершено (not complete)

- Предложение нагрузки остаётся stub с результатом `null`; автоматического увеличения нагрузки нет.
- Независимого режима повторений (reps mode) нет.
- Физическое удаление объекта фото из Storage не реализовано; удаляются только метаданные галереи.
- Резервные копии ограничены JSON до 20 МБ и фото до 5 МБ; большого ZIP-архива нет.
- Удаление аккаунта, billing и коммерческая юридическая подготовка не завершены.
- Исторический снимок плана привычек не реализован.
- Посторонняя `public.RAGformyAIagent` остаётся без RLS; её политики не менялись и не входят в этот проход.

## Исторический отчёт: 2026-09-11 и 2026-09-12

**Весь текст ниже является историческим.** Его SHA, test counts, CI, deployment, Telegram-подтверждения и открытые задачи описывают состояние на указанные прежние даты. Слова «текущий», «проверено» и «закрыто» ниже относятся к тому историческому проходу и не подтверждают код от 2026-09-30. Актуальный статус приведён только выше.

### Историческая production-проверка после разрешения на CLI, 2026-09-12

- Код `2efc6b1`: 58 тестов passed, lint, TypeScript и локальный production build passed.
- Официальная Vercel CLI: deployment `dpl_GPPe4cCkDtmFoegamoUCdEC2FaCC` READY, основной адрес `https://ritm-tracker.vercel.app` переключён.
- Загрузка выполнена из отдельного runtime-экспорта Git. `.private`, исходные резервные копии и `.env*` в deployment не включены.
- На реальном сервере выявлено и исправлено чтение Telegram-статуса: служебная таблица закрыта для authenticated; GET теперь проверяет владельца и читает только его строку серверным клиентом, не меняя права таблицы.
- Браузер на основном адресе: новые разделы настроек, 9 привычек, разрешение старого конфликта с резервными копиями; после reload статус «Изменения сохранены», повторного конфликта нет.
- Реальный POST создал Telegram-ссылку; GET после исправления показывает «Ожидаем запуск бота».
- Без cookie `/settings` отвечает 307 на `/login`. Webhook без секрета отвечает 401 (проверено на первом CLI deployment с тем же webhook-кодом).
- Реальный запуск бота по новой ссылке и доставка уведомления пока не подтверждены. Остальные незакрытые проверки ниже сохраняют силу; блокер production deploy снят.

### Историческая проверка 2026-09-12

Проверенный код: `3f5cb4bffd121933641d2f51145d86697034bd75`.

#### Написано в историческом проходе 2026-09-12
- Раздельные разделы настроек, раскрывающиеся упражнения, добавление привычек.
- Текстовые черновики числовых полей с проверкой при завершении ввода.
- Контрастные действия восстановления пароля и Telegram; автоматическая проверка привязки после возврата из Telegram.
- Устранено ошибочное назначение исторической тренировки активной при миграции.
- Атомарная серверная перепривязка Telegram по свежему токену и приватному сообщению отправителя.
- Перенос обновлённых cookies при redirect, устранение redirect-loop для другого аккаунта на login.

#### Локально проверено в историческом проходе 2026-09-12
- `pnpm@9.15.0 test`: 57 passed, 0 failed. Новый regression сначала воспроизвёл ошибку активной истории, затем прошёл.
- `pnpm@9.15.0 lint`, `pnpm@9.15.0 exec tsc --noEmit`, `pnpm@9.15.0 build`: passed.
- Обычный pnpm shim неисправен; команды выполнены через `npx --yes pnpm@9.15.0`.
- Через браузер: переключение разделов, раскрытие упражнения, последовательный ввод `12,` -> `12,5` -> blur -> `12.5`, сохранение после reload.
- На 390 и 1440 px проверены поля упражнения: горизонтального переполнения нет. Снимки показаны в разговоре.
- Экран login на 390 px, кнопка показа пароля и состояние отсутствующей конфигурации.
- Недоступный Telegram API показывает отсутствие связи, а не истёкшую ссылку.

#### Реальный сервис в историческом проходе 2026-09-12
- Приватная резервная копия исходного состояния сохранена в игнорируемой `.private/`; в GitHub не отправлена.
- В аккаунте восстановлены 9 событий/привычек из ранее предоставленных настроек, сохранены исходные ID и история. Личные названия и схема не добавлены в публичный код.
- В Supabase применена `telegram_atomic_relink`; вызов RPC запрещён `anon` и `authenticated`, разрешён `service_role`.
- Код отправлен в существующий GitHub-репозиторий.

#### Не проверено / не завершено в историческом проходе 2026-09-12
- Новое production-развёртывание: запрос с файлами превысил лимит review, вариант gitSource отклонён; запрошено разрешение на официальную Vercel CLI.
- Реальный `/start` и доставка Telegram с новой перепривязкой не проверены. Проверка на production-строках даже с rollback отклонена защитой; данные привязок этим тестом не изменены.
- Отдельная коррекция количества подходов в личном шаблоне отклонена защитой и не применена.
- Полный offline/reconnect, свежий login на сервере, WebKit и полный тренировочный путь этой ревизии не подтверждены.
- `tests/e2e/settings.spec.ts` добавлен, но runner не запускался; выше перечислены ручные проверки через управляемый браузер.

Ниже исторический отчёт, его результаты не являются проверкой текущего коммита.

---

Дата: 2026-09-11

Кодовый commit: `d1c6abf` (`feat: add password recovery flow`).

### Исторические локальные проверки 2026-09-11

- Основной Node test suite: **54 passed, 0 failed**.
- ESLint и TypeScript: passed.
- ESLint: passed без предупреждений; приватная галерея использует `next/image` с data URL и `unoptimized`.
- `next build`: passed; в сборке присутствуют middleware и `/api/workout/timer`.
- HTTP smoke production: anonymous `/` -> `200` с оболочкой входа, webhook/worker без секрета `401`, manifest и service worker `200`; отдельная fail-closed проверка без `RITM_OWNER_USER_ID` дала `307` на `/login?reason=not-configured`.
- Production `/` визуально открыт во встроенном браузере: показана публичная оболочка входа без приватного журнала. Обновлена Playwright-конфигурация на прямой Next dev server и порт `3002`; локальный e2e WebKit подтвердил оба API-теста, а UI-тест не стартовал из-за Windows `spawn EPERM` при запуске Playwright WebKit.
- Тот же access smoke в установленном Chrome через `PLAYWRIGHT_CHANNEL=chrome`: **3 passed** (redirect на login, webhook без cookie и worker с серверным секретом).
- Локальный Chrome demo smoke на viewport `390×844`: выбор шаблона → отдельная активная сессия → фактические `8` повторов → запись подхода → автоматический отдых → пропуск отдыха → следующий подход. Demo-данные не были production-аккаунтом и не синхронизировались.
- Локальный Chrome demo E2E на `1440×1000` и `390×844`: сохранённый план `4×8` → отдельная активная сессия → 12 фактических подходов → явный переход между упражнениями → завершение → отдельная запись итогов. Снимки сохранены в `artifacts/ui-review-final/desktop-active.png`, `desktop-summary.png`, `iphone-active.png`, `iphone-summary.png`; demo-данные не были production-аккаунтом и не синхронизировались.
- WebKit установлен и headless запуск подтвержден.
- Timer helper: version 1 -> reschedule version 2 (+30) -> cancel version 3.
- Outbox acknowledgement после успешного command request сохраняется в отдельном user-scoped localStorage ключе; основной sync payload не изменяется.
- Sync recovery: тестовое решение lost PUT response покрывает `accepted` при совпавшем payload и новой ревизии, `retry` при прежней ревизии и `conflict` при чужой новой версии; UI показывает offline/error и даёт ручной retry.
- Начальный sync сохраняет базовый локальный снимок до GET и не объявляет локальное действие, сделанное во время GET, конфликтом, если сервер всё ещё содержит этот базовый снимок.
- При пустом remote payload локальное состояние со статусом `loaded` отправляется после получения server revision.
- Отметки и отмены привычек на странице «Сегодня» теперь проходят через стабильные user-scoped outbox-команды с payload и версией; добавлен регрессионный тест идентичности команд.
- Sync-only habit-команды не отправляются в workout RPC: после успешного сохранения snapshot они получают `accepted` в отправляемом payload и локально, с durable ack.
- Supabase migration `20260911130000_telegram_delivery_fencing` применена и проверена SQL-запросом: `notification_jobs.lease_token`, resumable `telegram_updates`, RPC claim/finish доступны только `service_role`; устаревшая unfenced перегрузка finish удалена миграцией `20260911131000`.
- Миграция `20260911140000_telegram_link_delivery_status` применена в production Supabase; `telegram_links.delivery_status` и поля последней ошибки существуют, constraint ограничивает значения `connected/error`, служебные RPC-права не изменились.
- Owner-only endpoint `/api/telegram/test-job` и миграция `20260911132000_telegram_diagnostic_job` создают идемпотентную pending job на 60 секунд только по явному нажатию владельца; SQL-функция доступна только `service_role` и требует подтверждённую Telegram-привязку.
- Добавлен тест изоляции ack между пользователями и сохранения ack после reload.
- GitHub Actions CI для текущего кодового commit `4d575c5` (run `34610455510`) завершился успешно: install, test, lint, typecheck и production build.
- GitHub Actions CI для текущего кодового commit `67e39a3` (run `34614496023`) завершился успешно: install, test, lint, typecheck и production build.
- В Supabase структурно подтверждены composite FK `workout_sets(session_id,user_id) -> workout_sessions(id,user_id)` и права служебных RPC: claim/finish/diagnostic доступны только `service_role`, пользовательские workout RPC доступны `authenticated`, `anon` закрыт.
- Demo-режим middleware дополнительно требует явный флаг и отключён при `VERCEL=1`; production-конфигурация не может случайно открыть приватные маршруты через demo-флаг.
- Invalid Telegram callback сохраняет update даже при сетевой ошибке `answerCallbackQuery`; обработчик возвращает контролируемый `202` вместо необработанного исключения.
- Настройки упражнения теперь имеют приватные поля группы мышц, оборудования и положения оборудования; template preview показывает их перед стартом.
- Для составных упражнений настройки веса, режима и повторов редактируются отдельно для сегментов A/B; общий отдых остаётся на уровне завершённой пары.
- Active workout показывает составные плечи как `Подход 1 из 2` и `Подход 2 из 2`; E2E smoke дошёл до итогового экрана и сохранил снимки, но Windows runner зависает при остановке локального Next server.
- Настройки поддерживают добавление/удаление логического подхода; для составных упражнений изменение атомарно добавляет или удаляет пару сегментов.
- User-scoped storage больше не подхватывает глобальную legacy-запись автоматически; добавлен регрессионный тест. Старые данные сохраняются и предлагаются для явного переноса в авторизованных настройках.
- История завершённой тренировки позволяет изменить фактические вес и повторения отдельного подхода; значения валидируются и сохраняются user-scoped командой без изменения шаблона будущих занятий.
- Service worker больше не кеширует `/` как общий fallback: публичный cache содержит только login/manifest/assets, страницы аккаунта кешируются отдельно по user-scoped ключу, выход очищает активный account cache, а неизвестная offline-навигация отдаёт отдельное состояние «Нет связи», не форму входа. Добавлен регрессионный тест A15b.
- Кнопка выхода добавлена в основной production-раздел настроек; перед signOut очищается account-scoped PWA cache, user-scoped локальная история и outbox не удаляются.
- Telegram callback parser принимает составные entity id с двоеточиями; worker передаёт в кнопке UUID notification job, чтобы не превышать лимит Telegram `callback_data`, а webhook разрешает UUID обратно в server-side source entity.
- Страница входа содержит восстановление пароля через `resetPasswordForEmail`, а публичная `/update-password` принимает новый пароль только из recovery-сессии Supabase.

### Исторические production и Telegram 2026-09-11

- Production URL: `https://ritm-tracker.vercel.app/`.
- Подтверждённый production deployment для `090a803`: `dpl_mtPbaSRWRUc5KWfeqqXubJo5NkdR` (READY), alias `https://ritm-tracker.vercel.app/`.
- Production smoke после deployment: `/` -> `200` с оболочкой входа, `/manifest.webmanifest` -> `200`, `/sw.js` -> `200`, webhook GET -> `405` (маршрут доступен и принимает только POST).
- После `dpl_BB8YNyXgpWgfuqxX1wC4kG8Qmw9U` повторно проверены login shell, manifest и service worker; Vercel runtime errors за 15 минут после публикации: отсутствуют.
- После `dpl_9eQgMM4RubyiGChrDxg8gwhvfXya` повторно проверены login shell и service worker; Vercel runtime errors за 15 минут после публикации: отсутствуют.
- После `dpl_Aqh4oYZJW7Db9fMSabgQLxUaG97f` повторно проверены login shell и service worker; Vercel runtime errors за последний час: отсутствуют.
- После `dpl_HK8Gyrd7gCE7V6r7fKozFZpfDGnQ` проверен закрытый `/today`: `200` с login shell; Vercel runtime errors за 30 минут: отсутствуют.
- После `dpl_79fEryKe4mPQXZZAmGrTFpMdPD1Q` проверены `/` и `/sw.js`: `200`, login shell и service worker; Vercel runtime errors за 20 минут: отсутствуют.
- После `dpl_6gazvwbWfyueaYwdgj5SJbjgJb5J` повторно проверены `/` и `/sw.js`: `200`; Vercel runtime errors за 10 минут: отсутствуют. GitHub Actions для `0508125`: success.
- После `dpl_FyJXCpBR3bEFSAB6rx8fmjxycYAf` проверены `/login` и `/sw.js`: `200`; закрытые server endpoints не перенаправляются на login при GET (`405`), Vercel runtime errors за последний час: отсутствуют.
- После `dpl_5ATG5qfCeXUFhPE2h5qeDqvT5v41` повторно проверены `/login` и `/sw.js`: `200`; Vercel runtime errors за 30 минут: отсутствуют.
- После `dpl_mtPbaSRWRUc5KWfeqqXubJo5NkdR` повторно проверены `/login` и `/sw.js`: `200`; Vercel runtime errors за 30 минут: отсутствуют.
- После `dpl_7iP34k4R5oBLvyyVfZBStUxVNuaT` повторно проверены `/login` и `/sw.js`: `200`; Vercel runtime errors за 30 минут: отсутствуют.
- После `dpl_HXZoFXx1cZErs52DFmpyCZSxQNcx` повторно проверены `/login` и `/sw.js`: `200`; Vercel runtime errors за 30 минут: отсутствуют.
- После `dpl_EnMnX1c3wCVJCUxuwZwN1cCKDKNn` повторно проверены `/login` и `/sw.js`: `200`; Vercel runtime errors за 30 минут: отсутствуют.
- После `dpl_24teXCJiswwEk1jQXLeK8MWCUgHs` повторно проверены `/login` и `/sw.js`: `200`; Vercel runtime errors за 30 минут: отсутствуют.
- После `dpl_C2st8r7VyWipAj8nBm6gZUjrirW5` повторно проверены `/login` и `/sw.js`: `200`; Vercel runtime errors за 30 минут: отсутствуют.
- После `dpl_9uebkQGbVjWNdyKwhqAhbUU4bmtt` повторно проверены `/login` и `/sw.js`: `200`; Vercel runtime errors за 30 минут: отсутствуют.
- После `dpl_4QRjjZpq3MnhWpsCVgUp769mgu4n` проверены `/login` и `/sw.js`: `200`; Vercel runtime errors и error-level logs за 30 минут: отсутствуют.
- После `dpl_CLyRwYPrnX4CdzxCai8vazF9cnub` проверены `/login` и обновлённый `/sw.js`: `200`; новый service worker содержит account-scoped cache и offline-состояние без login fallback; Vercel runtime errors за 15 минут: отсутствуют.
- После `dpl_DZsStexAwsfttJVBNu2NnXLjvube` production `/settings` открыт в уже авторизованной Chrome-сессии: видны «Выйти», настройки упражнений и Telegram status; данные не изменялись. `/login` и `/sw.js`: `200`, runtime errors после публикации: отсутствуют.
- После `dpl_9MxB2UCN4Y6o9D5qMpgBTyQbRBjR` production сборка с callback parser fix прошла READY; после `dpl_694QwLAqwDLbC3zDk8tzBND9TJHY` production сборка с bounded callback payload прошла READY и получила alias `ritm-tracker.vercel.app`; Vercel build завершился успешно.
- После `dpl_3qFYgWC3QjXbJV6XVJ9P7eXyhqiR` production-сборка с восстановлением пароля прошла READY и получила alias `ritm-tracker.vercel.app`; `/login` проверен через Vercel fetch, status `200`, кнопка присутствует.
- GitHub Actions CI для commit `8d0288d` (run `34618337577`) завершился успешно.
- GitHub Actions CI для проверенного code tree `bb791d0` (run `34620504501`) завершился успешно; отдельный run на `4a15613` был отменён при следующем push.
- GitHub Actions CI для commit `fec3a27` (run `34617068037`) завершился успешно.
- GitHub Actions CI для commit `bc409ca` (run `34616241105`) завершился успешно.
- Повторная генерация link проверена кодовым путём: подтверждённое `telegram_user_id/connected_at` сохраняется до нового `/start`, а consumed token больше не принимается повторно.
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
- В настройках Telegram показывает фактический статус постоянной привязки (`connected/pending/disconnected/expired`), поддерживает подключение, переподключение, отключение и ручное обновление статуса; диагностическая job недоступна без подтвержденной связи.
- Outbox-команды имеют видимые статусы `sending`, `accepted` и `failed`; при ошибке запись остаётся локально и показывается пользователю для автоматического повтора.

### Исторические непроверенные и незавершённые сценарии 2026-09-11

- Реальная отправка production diagnostic job в Telegram — **ПРОВЕРЕНО**: по явному подтверждению владельца jobs `manual`, `recheck` и `td:pc2` были отправлены; последняя job завершилась как `sent`, одна попытка, `last_error=null`. Одна предыдущая длинная диагностическая сущность отдельно зафиксировала Telegram `BUTTON_DATA_INVALID`, после чего payload был исправлен на UUID job.
- Реальный callback update и `answerCallbackQuery` — **НЕ ЗАВЕРШЕНО**: после последнего корректного сообщения `td:pc2` в `telegram_updates` пока нет callback update, поэтому production `+30` ещё не подтверждён фактическим нажатием.
- Production `+30` с заменой dueAt и production cancel — **НЕ ПРОВЕРЕНО**.
- `pg_cron`, `pg_net` и `supabase_vault` включены; job `ritm-telegram-worker-every-10-seconds` активен. После последнего redeploy вызовы worker получили HTTP `200` и `processed: 0`; активная Telegram-привязка существует, pending jobs нет.
- Два устройства/два аккаунта и полноценное conflict resolution — **НЕ ПРОВЕРЕНО**.
- Изолированный rollback-тест composite FK на двух реальных Auth-пользователях не выполнен: в текущем Supabase проекте обнаружена только одна Auth-учётка; новые тестовые учётки намеренно не создавались.
- Явный перенос legacy storage реализован, но на production не подтверждался на реальном аккаунте, чтобы не менять личный журнал.
- Bundled Chromium/WebKit Playwright в Windows остаются ограничены `spawn EPERM`; установленный Chrome через `PLAYWRIGHT_CHANNEL=chrome` прошёл полный access smoke 3/3.
- Автоматическое завершение Playwright demo после двух viewport зависает на остановке локального Next dev server в Windows; сами действия обоих тестов дошли до итогового экрана, а четыре снимка визуально проверены. Это не объявляется стабильным CI E2E до устранения зависания runner.
- Полный iPhone offline/background/lock-screen сценарий — **НЕ ПРОВЕРЕНО**; реализован account-scoped service-worker cache и отдельная offline-страница, но физический iPhone/background сценарий не выполнялся.
- RLS для посторонней таблицы `public.RAGformyAIagent` не менялся; её назначение и корректные политики не подтверждены.
- Supabase security advisor всё ещё сообщает об отключённой leaked-password protection, RLS/GraphQL exposure для посторонней `public.RAGformyAIagent` и public `vector` extension; эти настройки требуют отдельного решения владельца проекта и намеренно не менялись автоматически.

### Исторические ограничения теста 2026-09-11

Production account использовался read-only. Реальная тестовая тренировка и job не создавались, чтобы не добавлять лишнюю запись в личный журнал. `pnpm test/lint/tsc` в этом проходе не завершили установочную проверку из-за `EACCES` при обращении pnpm к registry; эквивалентные локальные команды через установленные бинарники и production build завершились успешно.
- GitHub Actions CI для текущего HEAD `bb791d0` (run `34620504501`) завершился успешно.
- GitHub Actions CI для code tree `bb791d0` (run `34620504501`) завершился успешно.
