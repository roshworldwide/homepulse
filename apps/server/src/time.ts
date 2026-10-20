/** Time-zone helpers. Everything is computed with Intl so the server's own TZ does not matter. */

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function zonedParts(ms: number, tz: string): ZonedParts {
  const parts = Object.fromEntries(fmt(tz).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Local wall-clock minus UTC, in minutes, at instant `ms`. */
export function tzOffsetMinutes(ms: number, tz: string): number {
  const p = zonedParts(ms, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, "0");

/** ISO 8601 with the zone's offset, e.g. 2026-10-22T14:00:00-07:00. */
export function isoInTz(ms: number, tz: string): string {
  const p = zonedParts(ms, tz);
  const off = tzOffsetMinutes(ms, tz);
  const sign = off >= 0 ? "+" : "-";
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${sign}${pad(Math.trunc(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}

/** The UTC instant of a local wall-clock time in `tz`. */
export function zonedToUtcMs(year: number, month: number, day: number, hour: number, minute: number, tz: string): number {
  let guess = Date.UTC(year, month - 1, day, hour, minute);
  for (let i = 0; i < 3; i++) {
    const off = tzOffsetMinutes(guess, tz);
    const next = Date.UTC(year, month - 1, day, hour, minute) - off * 60000;
    if (next === guess) break;
    guess = next;
  }
  return guess;
}

export function formatClock(ms: number, tz: string): string {
  const p = zonedParts(ms, tz);
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const ampm = p.hour < 12 ? "AM" : "PM";
  return p.minute === 0 ? `${h12} ${ampm}` : `${h12}:${pad(p.minute)} ${ampm}`;
}

export function format24(ms: number, tz: string): string {
  const p = zonedParts(ms, tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

function dayLabel(ms: number, nowMs: number, tz: string): string {
  const a = zonedParts(ms, tz);
  const b = zonedParts(nowMs, tz);
  const da = Date.UTC(a.year, a.month - 1, a.day);
  const db = Date.UTC(b.year, b.month - 1, b.day);
  const diff = Math.round((da - db) / 86400000);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "short", day: "numeric" }).format(new Date(ms));
}

/** "today 2 to 3 PM", "tomorrow 11 AM to 1 PM". */
export function formatWindow(startIso: string, endIso: string, tz: string, nowMs: number): string {
  const s = Date.parse(startIso);
  const e = Date.parse(endIso);
  const sp = zonedParts(s, tz);
  const ep = zonedParts(e, tz);
  const sameHalf = sp.hour < 12 === ep.hour < 12;
  const startText = formatClock(s, tz);
  const start = sameHalf ? startText.replace(/ (AM|PM)$/, "") : startText;
  return `${dayLabel(s, nowMs, tz)} ${start} to ${formatClock(e, tz)}`;
}

/** Hour of day in `tz`. */
export function localHour(ms: number, tz: string): number {
  return zonedParts(ms, tz).hour;
}
