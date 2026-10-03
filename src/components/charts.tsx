import { formatLocalDate } from "@/lib/tracker";

export type ChartPoint = { label: string; value: number };

const W = 320;
const H = 150;
const PAD = { left: 8, right: 8, top: 12, bottom: 12 };

function scale(values: number[]) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.max(1, Math.abs(max) * 0.1);
  return { low: min - span * 0.15, high: max + span * 0.15 };
}

const fmt = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value);

/** Линейный график без внешних библиотек. Точки идут от старых к новым; меток дат (YYYY-MM-DD) — первая и последняя. */
export function LineChart({ points, unit, title, emptyText = "Нужно хотя бы две записи, чтобы построить график." }: { points: ChartPoint[]; unit: string; title: string; emptyText?: string }) {
  if (points.length < 2) return <p className="chartEmpty muted">{emptyText}</p>;
  const { low, high } = scale(points.map((p) => p.value));
  const x = (index: number) => PAD.left + (index / (points.length - 1)) * (W - PAD.left - PAD.right);
  const y = (value: number) => PAD.top + (1 - (value - low) / (high - low)) * (H - PAD.top - PAD.bottom);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)} ${H - PAD.bottom} L${x(0).toFixed(1)} ${H - PAD.bottom} Z`;
  const last = points.at(-1)!;
  const max = Math.max(...points.map((p) => p.value));
  const min = Math.min(...points.map((p) => p.value));
  const gradientId = `grad-${title.replace(/\W+/g, "") || "chart"}`;
  return <figure className="chart">
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: от ${fmt(points[0].value)} до ${fmt(last.value)} ${unit}`} preserveAspectRatio="none">
      <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" /><stop offset="100%" stopColor="var(--accent)" stopOpacity="0" /></linearGradient></defs>
      {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={PAD.left} x2={W - PAD.right} y1={PAD.top + f * (H - PAD.top - PAD.bottom)} y2={PAD.top + f * (H - PAD.top - PAD.bottom)} className="chartGrid" />)}
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={line} className="chartLine" />
    </svg>
    <div className="chartDots" aria-hidden="true">{points.map((p, i) => <i key={`${p.label}-${i}`} style={{ left: `${(x(i) / W) * 100}%`, top: `${(y(p.value) / H) * 100}%` }} />)}</div>
    <figcaption><span>{formatLocalDate(points[0].label)}</span><span className="chartRange">{fmt(min)}–{fmt(max)} {unit}</span><span>{formatLocalDate(last.label)}</span></figcaption>
  </figure>;
}

/** Столбики: подписи — произвольные строки, значения неотрицательные. */
export function BarChart({ bars, unit, title, emptyText = "Пока нет данных для графика." }: { bars: Array<{ label: string; value: number }>; unit: string; title: string; emptyText?: string }) {
  const max = Math.max(0, ...bars.map((b) => b.value));
  if (!bars.length || max === 0) return <p className="chartEmpty muted">{emptyText}</p>;
  return <figure className="chart">
    <div className="bars" role="img" aria-label={`${title}, ${unit}`}>
      {bars.map((bar) => <div className="bar" key={bar.label} title={`${bar.label}: ${fmt(bar.value)} ${unit}`}><span style={{ height: `${Math.max(4, (bar.value / max) * 100)}%` }} /><small>{bar.label}</small></div>)}
    </div>
    <figcaption><span>Максимум: {fmt(max)} {unit}</span></figcaption>
  </figure>;
}
