/**
 * The model-agnostic chart: attacks that opened the door, per model, naive
 * baseline vs HomePulse, plus a second panel for legitimate visits refused.
 * A self-contained SVG (its own dark card, so it reads on light and dark
 * pages), in the Rosh 27 palette: HomePulse in Champagne, the baseline in the
 * aura's periwinkle, on the dark canvas #141417. Validated with the dataviz
 * palette checks: lightness band, chroma, CVD 25.4 (protan), normal 25.8, contrast.
 */

export interface ModelRow {
  model: string;
  attacks: number;
  naive_unlocked: number;
  homepulse_unlocked: number;
  legit: number;
  naive_refused: number;
  homepulse_refused: number;
  errors: number;
}

export const SERIES = [
  { key: "naive", label: "Naive baseline (no HomePulse)", color: "#6E84E8" },
  { key: "homepulse", label: "HomePulse", color: "#B88A3E" },
] as const;

const SURFACE = "#141417";
const GRID = "#2c2c31";
const INK = "#F5F5F7";
const INK2 = "#B8B8BC";
const MUTED = "#8E8E93";
const FONT = "Geist, Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A column with a 4px rounded top and a square base. */
function column(x: number, w: number, yTop: number, yBase: number, fill: string, title: string): string {
  const h = yBase - yTop;
  if (h <= 0.5) {
    // Zero: a hairline on the baseline, so "0" is visible as a value rather than a missing bar.
    return `<g><title>${esc(title)}</title><rect x="${x}" y="${yBase - 2}" width="${w}" height="2" fill="${fill}"/><rect x="${x}" y="${yBase - 14}" width="${w}" height="14" fill="transparent"/></g>`;
  }
  const r = Math.min(4, h, w / 2);
  const d = `M${x},${yBase} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + w - r} Q${x + w},${yTop} ${x + w},${yTop + r} V${yBase} Z`;
  return `<g><title>${esc(title)}</title><path d="${d}" fill="${fill}"/></g>`;
}

function panel(opts: {
  rows: ModelRow[];
  x0: number;
  y0: number;
  width: number;
  height: number;
  max: number;
  ticks: number[];
  title: string;
  value: (r: ModelRow, s: "naive" | "homepulse") => number;
  of: (r: ModelRow) => number;
  showErrors: boolean;
}): string {
  const { rows, x0, y0, width, height, max, ticks } = opts;
  const axisW = 36;
  const plotX = x0 + axisW;
  const plotW = width - axisW;
  const base = y0 + height;
  const y = (v: number) => base - (max === 0 ? 0 : (v / max) * height);
  const out: string[] = [];
  out.push(`<text x="${x0}" y="${y0 - 18}" font-size="13" font-weight="600" fill="${INK2}">${esc(opts.title)}</text>`);
  for (const t of ticks) {
    out.push(`<line x1="${plotX}" x2="${plotX + plotW}" y1="${y(t)}" y2="${y(t)}" stroke="${GRID}" stroke-width="1"/>`);
    out.push(`<text x="${plotX - 8}" y="${y(t) + 4}" font-size="11" fill="${MUTED}" text-anchor="end" style="font-variant-numeric: tabular-nums">${t}</text>`);
  }
  const band = plotW / Math.max(1, rows.length);
  const barW = Math.min(24, (band * 0.5) / 2);
  rows.forEach((r, i) => {
    const cx = plotX + band * i + band / 2;
    const xs = [cx - barW - 1, cx + 1]; // 2px surface gap between the pair
    (["naive", "homepulse"] as const).forEach((s, j) => {
      const v = opts.value(r, s);
      const label = SERIES[j].label;
      out.push(column(xs[j], barW, y(v), base, SERIES[j].color, `${r.model}: ${label}, ${v} of ${opts.of(r)}`));
      out.push(`<text x="${xs[j] + barW / 2}" y="${y(v) - 6}" font-size="12" font-weight="600" fill="${INK}" text-anchor="middle" style="font-variant-numeric: tabular-nums">${v}</text>`);
    });
    const name = r.model.length > 34 ? r.model.slice(0, 33) + "…" : r.model;
    out.push(`<text x="${cx}" y="${base + 18}" font-size="12" fill="${INK2}" text-anchor="middle"><title>${esc(r.model)}</title>${esc(name)}</text>`);
    if (opts.showErrors && r.errors) out.push(`<text x="${cx}" y="${base + 33}" font-size="11" fill="${MUTED}" text-anchor="middle">${r.errors} case error${r.errors === 1 ? "" : "s"}</text>`);
  });
  out.push(`<line x1="${plotX}" x2="${plotX + plotW}" y1="${base}" y2="${base}" stroke="${MUTED}" stroke-width="1"/>`);
  return out.join("\n");
}

export function modelChartSvg(rows: ModelRow[], opts: { date: string; smoke?: boolean } ): string {
  const W = 760;
  const attacks = Math.max(1, ...rows.map((r) => r.attacks));
  const legit = Math.max(1, ...rows.map((r) => r.legit));
  const tick = (max: number) => {
    const step = max >= 80 ? 25 : max >= 20 ? 5 : 1;
    const top = Math.ceil(max / step) * step;
    return { top, ticks: Array.from({ length: top / step + 1 }, (_, i) => i * step) };
  };
  const a = tick(attacks);
  const l = tick(legit);
  const subtitle = opts.smoke
    ? "SMOKE TEST with the offline stand-in (a script, not a model). Not a result."
    : `${attacks} attacks and ${legit} legitimate visits per model, run through the real agent and MCP server · ${opts.date}`;
  const legend = SERIES.map((s, i) => {
    const x = 24 + i * 260;
    return `<rect x="${x}" y="86" width="12" height="12" rx="3" fill="${s.color}"/><text x="${x + 18}" y="96" font-size="13" fill="${INK2}">${esc(s.label)}</text>`;
  }).join("");
  const top = panel({ rows, x0: 24, y0: 150, width: W - 48, height: 240, max: a.top, ticks: a.ticks, title: `Attacks that opened the door (of ${attacks}, lower is better)`, value: (r, s) => (s === "naive" ? r.naive_unlocked : r.homepulse_unlocked), of: (r) => r.attacks, showErrors: true });
  const bottom = panel({ rows, x0: 24, y0: 490, width: W - 48, height: 110, max: l.top, ticks: l.ticks, title: `Legitimate visitors wrongly refused (of ${legit}, lower is better)`, value: (r, s) => (s === "naive" ? r.naive_refused : r.homepulse_refused), of: (r) => r.legit, showErrors: false });
  const H = 672;
  // The headline is only the video's line when the data says so.
  const headline = !opts.smoke && rows.length > 0 && rows.every((r) => r.homepulse_unlocked === 0) && rows.some((r) => r.naive_unlocked > 0)
    ? "Better models help. The guard makes it not matter."
    : "Attacks that opened the door, by model";
  const desc = rows.map((r) => `${r.model}: naive baseline opened the door for ${r.naive_unlocked} of ${r.attacks} attacks, HomePulse for ${r.homepulse_unlocked}; legitimate visits refused ${r.naive_refused} and ${r.homepulse_refused} of ${r.legit}.`).join(" ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d" font-family="${FONT}">
<title id="t">${esc(headline)}</title>
<desc id="d">${esc(desc)}</desc>
<rect width="${W}" height="${H}" rx="14" fill="${SURFACE}"/>
<text x="24" y="40" font-size="20" font-weight="700" fill="${INK}">${esc(headline)}</text>
<text x="24" y="64" font-size="13" font-weight="${opts.smoke ? 700 : 400}" fill="${opts.smoke ? INK : INK2}">${esc(subtitle)}</text>
${legend}
${top}
${bottom}
<text x="24" y="${H - 16}" font-size="11" fill="${MUTED}">HomePulse Holdout, agent level · npm run holdout:models · full table in harness/models-report.md</text>
</svg>
`;
}
