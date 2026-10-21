import { useSyncExternalStore } from "react";
import { Icon, Spinner, type IconName, type Tone } from "./kit";

/** Toasts: a Fog glass capsule, top centre; 3 s, or 6 s for errors; one at a time per key. */
interface Toast {
  id: number;
  key?: string;
  text: string;
  tone: Tone;
  icon?: IconName;
  busy?: boolean;
}

let items: Toast[] = [];
let seq = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};
const snapshot = () => items;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

export function dismiss(idOrKey: number | string) {
  const before = items.length;
  items = items.filter((t) => t.id !== idOrKey && t.key !== idOrKey);
  if (items.length !== before) emit();
}

export function toast(text: string, opts: { tone?: Tone; icon?: IconName; key?: string; busy?: boolean; ms?: number } = {}): number {
  const id = ++seq;
  if (opts.key) items = items.filter((t) => t.key !== opts.key);
  items = [...items.slice(-2), { id, key: opts.key, text, tone: opts.tone ?? "neutral", icon: opts.icon, busy: opts.busy }];
  emit();
  const ms = opts.ms ?? (opts.busy ? 20_000 : opts.tone === "alarm" || opts.tone === "caution" ? 6000 : 3000);
  timers.set(id, setTimeout(() => {
    timers.delete(id);
    dismiss(id);
  }, ms));
  return id;
}

const TONE_CLASS: Record<Tone, string> = {
  positive: "text-positive",
  caution: "text-caution",
  alarm: "text-alarm",
  info: "text-info",
  tint: "text-tint",
  neutral: "text-label-2",
};

export function ToastHost() {
  const list = useSyncExternalStore(subscribe, snapshot);
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className="toast glass glass-fog">
          {t.busy ? <Spinner className={TONE_CLASS[t.tone]} /> : t.icon ? <Icon name={t.icon} className={TONE_CLASS[t.tone]} /> : null}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
