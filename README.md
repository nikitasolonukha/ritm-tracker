# Ритм

Личный PWA-трекер привычек, приёмов, тренировок и наблюдений. Текущая версия — первый локальный вертикальный срез: данные сохраняются в `localStorage`, есть очередь будущей синхронизации, но Supabase и Telegram ещё не подключены к реальному backend.

## Что уже работает

- Экран `Сегодня`: план дня, быстрые отметки, защита от повторной отметки одной привычки за локальный день.
- Экран `Зал`: запись подходов, вес/повторы, отметка выполнения, расчёт фактического объёма, таймер отдыха на 180/240 секунд.
- Импорт заметок: вставка текста тренировки, разбор даты, упражнений, подходов и настроек тренажёра.
- Экран `Прогресс`: история тренировок, недельная лента и диагностика локальной очереди.
- PWA shell: manifest, иконка, service worker для базового offline shell.

## Команды

```bash
pnpm install
pnpm dev
pnpm build
pnpm lint
pnpm test
```

На этой машине `npm` и `npx` сейчас нерабочие из-за отсутствующего глобального `npm-cli.js`. Внутри Codex-обёртки `pnpm test/lint` также пытаются запускать dependency check и могут падать до выполнения скрипта. Проверенные команды:

```bash
node --test --experimental-strip-types tests\tracker.test.ts
.\node_modules\.bin\eslint "src/**/*.{ts,tsx}" "tests/**/*.ts"
.\node_modules\.bin\tsc --noEmit
.\node_modules\.bin\next build
```

## Архитектурные решения

- Frontend: Next.js App Router.
- Хранилище первой версии: локальный `localStorage` плюс outbox команд для будущей синхронизации.
- Доменная логика вынесена в `src/lib/tracker.ts` и покрыта тестами отдельно от UI.
- Реальные напоминания не делаются через Vercel Hobby Cron: по официальной документации Vercel Hobby ограничен запуском раз в день и точностью в пределах часа.
- Для production-напоминаний целевая схема: Supabase Postgres + RLS + Edge Functions + Cron/очередь задач + Telegram Bot API.

## Проверка лимитов

Дата проверки: 2026-09-09.

- Next.js PWA docs: [nextjs.org/docs/app/guides/progressive-web-apps](https://nextjs.org/docs/app/guides/progressive-web-apps). Документация описывает manifest, service worker, push и локальную проверку PWA.
- Supabase Edge Functions pricing: [supabase.com/docs/guides/functions/pricing](https://supabase.com/docs/guides/functions/pricing). Free quota указана как 500,000 invocations; сверх квоты на платных планах — $2 за 1M invocations.
- Supabase Cron quickstart: [supabase.com/docs/guides/cron/quickstart](https://supabase.com/docs/guides/cron/quickstart).
- Vercel Cron usage/pricing: [vercel.com/docs/cron-jobs/usage-and-pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing). Hobby: 100 cron jobs per project, minimum interval once per day, scheduling precision per-hour.

Расчёт из брифа: вызов Edge Function каждые 10 секунд постоянно за 31 день = `31 * 24 * 60 * 6 = 267,840` вызовов. Это меньше 500,000, но такая схема всё равно плохая для напоминаний: она тратит квоту на пустые циклы и не решает доставку/повторы надёжно.

## Что нужно для production

- Supabase migrations с таблицами users, habits, habit_completions, workouts, exercise_sets, observations, photos, reminder_jobs, command_outbox.
- RLS-политики на все таблицы, views/RPC и Storage bucket.
- Telegram auth verification для WebApp init data и webhook handler с идемпотентными callback-командами.
- Закрытый Storage bucket для фото, thumbnail/compression pipeline, удаление EXIF/геометаданных.
- Реальная очередь напоминаний с lease/lock, retry, 429 handling и отдельными состояниями `scheduled/sent/failed/cancelled`.
- Экспорт/импорт JSON и CSV с защитой от дублей.
