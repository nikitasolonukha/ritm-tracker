import { workoutResults } from "./exercises.ts";
import { calculateWorkoutTotals, formatLocalDate, russianWord, type Workout } from "./tracker.ts";
import type { SessionTrackerState, WorkoutSession } from "./workout-session.ts";

export const SHARE_CARD_SIZE = { width: 1080, height: 1350 } as const;
export const SHARE_CARD_MAX_ROWS = 7;

export type ShareCardModel = {
  title: string;
  dateText: string;
  durationText?: string;
  stats: Array<{ value: string; label: string }>;
  recordCount: number;
  rows: Array<{ name: string; sets: string; record: boolean }>;
  /** Сколько упражнений не поместилось в карточку. */
  more: number;
};

const durationText = (seconds: number) => {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes < 60 ? `${minutes} мин` : `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
};

/** Данные карточки итога: только записанное, без оценок и советов. */
export function buildShareCardModel(state: SessionTrackerState, workout: Workout, session: Pick<WorkoutSession, "startedAt" | "finishedAt">): ShareCardModel {
  const totals = calculateWorkoutTotals(workout);
  const results = workoutResults(state, workout);
  const duration = session.finishedAt ? (Date.parse(session.finishedAt) - Date.parse(session.startedAt)) / 1000 : 0;
  return {
    title: workout.title,
    dateText: formatLocalDate(workout.date),
    ...(duration > 0 ? { durationText: durationText(duration) } : {}),
    stats: [
      { value: String(totals.completedLogicalSets), label: russianWord(totals.completedLogicalSets, "подход", "подхода", "подходов") },
      { value: String(totals.exercises), label: russianWord(totals.exercises, "упражнение", "упражнения", "упражнений") },
      { value: totals.volumeKg.toLocaleString("ru-RU"), label: "кг объёма" },
    ],
    recordCount: results.filter((item) => item.record).length,
    rows: results.slice(0, SHARE_CARD_MAX_ROWS).map(({ name, sets, record }) => ({ name, sets, record })),
    more: Math.max(0, results.length - SHARE_CARD_MAX_ROWS),
  };
}

export function shareFileName(workout: Pick<Workout, "date">) {
  return `ritm-${workout.date}.png`;
}

type Ctx = CanvasRenderingContext2D;

/** Обрезает строку многоточием, чтобы она поместилась в ширину. */
function fit(ctx: Ctx, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let end = text.length;
  while (end > 1 && ctx.measureText(`${text.slice(0, end).trimEnd()}…`).width > maxWidth) end -= 1;
  return `${text.slice(0, end).trimEnd()}…`;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const FONT = '"Inter", -apple-system, "Segoe UI", Roboto, sans-serif';

/** Рисует карточку 1080×1350 (4:5) и отдаёт PNG. Только в браузере. */
export async function renderShareCard(model: ShareCardModel): Promise<Blob> {
  const { width, height } = SHARE_CARD_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Не удалось создать картинку на этом устройстве.");
  try { await document.fonts?.ready; } catch { /* системный шрифт подойдёт */ }

  ctx.fillStyle = "#060709";
  ctx.fillRect(0, 0, width, height);
  const glow = ctx.createRadialGradient(width * 0.1, 0, 0, width * 0.1, 0, width * 0.95);
  glow.addColorStop(0, "rgba(255, 107, 44, 0.42)");
  glow.addColorStop(1, "rgba(255, 107, 44, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  const pad = 80;
  const inner = width - pad * 2;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ff6b2c";
  ctx.font = `800 40px ${FONT}`;
  ctx.fillText("РИТМ", pad, 130);
  ctx.fillStyle = "#9aa0ac";
  ctx.font = `500 34px ${FONT}`;
  const meta = [model.dateText, model.durationText].filter(Boolean).join(" · ");
  ctx.textAlign = "right";
  ctx.fillText(meta, width - pad, 130);
  ctx.textAlign = "left";

  ctx.fillStyle = "#ffffff";
  ctx.font = `800 84px ${FONT}`;
  ctx.fillText(fit(ctx, model.title, inner), pad, 270);

  const tileGap = 24;
  const tileWidth = (inner - tileGap * 2) / 3;
  model.stats.forEach((stat, index) => {
    const x = pad + index * (tileWidth + tileGap);
    roundRect(ctx, x, 330, tileWidth, 190, 32);
    ctx.fillStyle = "#14171d";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = `800 68px ${FONT}`;
    ctx.fillText(fit(ctx, stat.value, tileWidth - 40), x + 28, 435);
    ctx.fillStyle = "#9aa0ac";
    ctx.font = `500 30px ${FONT}`;
    ctx.fillText(fit(ctx, stat.label, tileWidth - 40), x + 28, 485);
  });

  let y = 600;
  if (model.recordCount > 0) {
    roundRect(ctx, pad, y, inner, 84, 42);
    ctx.fillStyle = "rgba(255,107,44,0.16)";
    ctx.fill();
    ctx.fillStyle = "#ff8a55";
    ctx.font = `700 34px ${FONT}`;
    ctx.fillText(model.recordCount === 1 ? "Новый рекорд по весу" : `Новых рекордов по весу: ${model.recordCount}`, pad + 36, y + 55);
    y += 124;
  }

  const rowHeight = 100;
  for (const row of model.rows) {
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(pad, y + rowHeight - 1, inner, 2);
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 38px ${FONT}`;
    const badge = row.record ? 150 : 0;
    ctx.fillText(fit(ctx, row.name, inner - badge), pad, y + 42);
    ctx.fillStyle = "#9aa0ac";
    ctx.font = `500 30px ${FONT}`;
    ctx.fillText(fit(ctx, row.sets, inner), pad, y + 82);
    if (row.record) {
      ctx.fillStyle = "#ff6b2c";
      ctx.font = `700 28px ${FONT}`;
      ctx.textAlign = "right";
      ctx.fillText("РЕКОРД", width - pad, y + 42);
      ctx.textAlign = "left";
    }
    y += rowHeight;
  }
  if (model.more > 0) {
    ctx.fillStyle = "#9aa0ac";
    ctx.font = `500 32px ${FONT}`;
    ctx.fillText(`и ещё ${model.more} ${russianWord(model.more, "упражнение", "упражнения", "упражнений")}`, pad, y + 50);
  }

  ctx.fillStyle = "#5d6370";
  ctx.font = `500 28px ${FONT}`;
  ctx.fillText("ritm-tracker.vercel.app", pad, height - 70);

  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Не удалось сохранить картинку.")), "image/png"));
}

/** Делится файлом через системное меню; если его нет, скачивает PNG. Возвращает, что произошло. */
export async function shareOrDownload(blob: Blob, fileName: string, title: string): Promise<"shared" | "downloaded" | "cancelled"> {
  const file = new File([blob], fileName, { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
  if (typeof nav.share === "function" && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      // системное меню недоступно: ниже скачаем файл
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded";
}
