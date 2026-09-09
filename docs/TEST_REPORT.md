# TEST_REPORT

Дата: 2026-09-09

## Реализовано

- Next.js PWA-приложение `Ритм` в текущей папке.
- Главный экран привычек с быстрыми отметками.
- Дневник тренировки с подходами, весом, повторами, таймером отдыха и расчётом объёма.
- Парсер вставленных заметок тренировок.
- Локальное сохранение состояния и outbox будущей синхронизации.
- PWA manifest, SVG icon и service worker.
- Документация `.env.example`, README и этот отчёт.

## Автоматически проверено

```bash
node --test --experimental-strip-types tests\tracker.test.ts
```

Результат: 8 тестов, 8 passed.

Покрытые сценарии:

- `45×8×4 = 1440` для обычного веса.
- Гантели с `per-hand` режимом.
- Плановые и неполные подходы не входят в фактический объём.
- Повтор команды и двойной тап не создают дубль.
- Пять разных локальных дней отличаются от пяти отметок за один день.
- Восстановление таймера 240/180 секунд после refresh.
- Импорт даты, упражнений, настроек тренажёра и записи `в отказ` без выдуманных повторов.
- Подсказка веса появляется только после стабильной истории.

```bash
.\node_modules\.bin\tsc --noEmit
```

Результат: passed.

```bash
.\node_modules\.bin\eslint "src/**/*.{ts,tsx}" "tests/**/*.ts"
```

Результат: passed.

```bash
.\node_modules\.bin\next build
```

Результат: passed. Главная страница собрана как static route.

Ограничение окружения: `pnpm test` и `pnpm lint` внутри текущей Codex-обёртки падали до запуска scripts с `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`, потому что wrapper пытался выполнить dependency check/install без TTY. Те же проверки через локальные бинарники выше прошли.

## Вручную проверено

- Headless Chromium smoke test на `http://localhost:3000`:
  - desktop viewport `1440x1000`;
  - mobile viewport `390x844`;
  - загрузка главной страницы;
  - переход во вкладку `Зал`;
  - запуск таймера `180`;
  - импорт заметок;
  - сохранение скриншотов [desktop-home.png](./desktop-home.png) и [mobile-home.png](./mobile-home.png).

Команда запускалась через Playwright. Первый запуск потребовал установку Chromium.

## Требует ключей или действий пользователя

- Supabase project URL/keys, миграции и Storage bucket.
- Telegram bot token, webhook secret, owner id и регистрация webhook.
- Деплой на Vercel и проверка, что preview-сборки не отправляют production-уведомления.
- Установка PWA на iPhone, блокировка экрана, проверка Telegram-уведомлений и сценарии с наушниками.

## Не завершено

- Реальный backend, RLS и интеграционные тесты с Postgres.
- Реальные Telegram reminders и callback buttons.
- Фото кожи/тела, приватные signed URLs и удаление файлов.
- Offline IndexedDB command log с конфликтами между вкладками/устройствами.
- Playwright E2E сценарии.
- Экспорт/восстановление JSON/CSV.
