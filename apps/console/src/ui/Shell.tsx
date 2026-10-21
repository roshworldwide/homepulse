import { useEffect, useRef, useState, type ReactNode } from "react";
import { fmtTime, useServerClock, type State } from "../lib/api";
import { useTheme, type ThemePref } from "../lib/theme";
import { Button, Icon, Live, Mark, Segmented, Tag, Wordmark, type IconName } from "./kit";
import { ToastHost } from "./toast";

type Page = "console" | "alexa";

const PAGES: Array<{ id: Page | "break-it"; href: string; label: string; icon: IconName }> = [
  { id: "console", href: "/console", label: "Console", icon: "space_dashboard" },
  { id: "alexa", href: "/alexa", label: "Alexa+", icon: "graphic_eq" },
  { id: "break-it", href: "/break-it", label: "Break in", icon: "door_front" },
];

/** Status tags for the house and the run. Each one carries a word, never colour alone. */
export function HouseTags({ state }: { state: State }) {
  return (
    <>
      {state.demo_mode && (
        <Tag tone="caution" icon="science" title="DEMO_MODE: scenario clock and simulated devices">
          Demo mode
        </Tag>
      )}
      {state.scenario && <Tag icon="play_arrow">Scenario: {state.scenario}</Tag>}
      {state.home.night_mode && (
        <Tag tone="info" icon="bedtime">
          Night mode{state.home.night_mode_source === "manual" ? " (set by hand)" : ""}
        </Tag>
      )}
      {state.home.away_lockdown && (
        <Tag tone="caution" icon="lock">
          Lockdown
        </Tag>
      )}
    </>
  );
}

function Sidebar({ page, state, nav, onNavigate }: { page: Page; state: State | null; nav?: ReactNode; onNavigate?: () => void }) {
  const [theme, setTheme] = useTheme();
  return (
    <nav aria-label="HomePulse" className="flex min-h-full flex-col">
      <a href="/console" className="flex items-center gap-2.5 rounded-12 px-3 pb-2 pt-3.5" onClick={onNavigate}>
        <Mark size={30} />
        <span className="min-w-0">
          <Wordmark className="block text-[19px] leading-none" />
          <span className="mt-1 block text-caption text-label-2">Guarded doors for Alexa+</span>
        </span>
      </a>
      <div className="px-2">
        <div className="nav-head">Pages</div>
        {PAGES.map((p) => (
          <a key={p.id} href={p.href} className="nav-row" aria-current={p.id === page ? "page" : undefined} onClick={onNavigate}>
            <Icon name={p.icon} />
            {p.label}
          </a>
        ))}
        {nav}
      </div>
      <div className="mt-auto space-y-3 px-3 pb-3 pt-6">
        {state && (
          <div className="flex items-start gap-2 text-caption text-label-2" title="Which model is answering">
            <Icon name="smart_toy" size={16} className="mt-px" />
            <span className="min-w-0 break-words">{state.model.label}</span>
          </div>
        )}
        <Segmented<ThemePref>
          label="Appearance"
          className="w-full"
          value={theme}
          onChange={setTheme}
          options={[
            { value: "auto", icon: "contrast", title: "Match the system" },
            { value: "light", icon: "light_mode", title: "Light" },
            { value: "dark", icon: "dark_mode", title: "Dark" },
          ]}
        />
      </div>
    </nav>
  );
}

/**
 * Desktop and web anatomy: a floating Fog-glass sidebar (260), a Fog-glass toolbar
 * over a 24 pt scroll edge, and the content column. Below 1024 px the sidebar is a drawer.
 */
export function AppShell({ page, title, subtitle, state, connected, nav, children }: { page: Page; title: string; subtitle?: string; state: State | null; connected: boolean; nav?: ReactNode; children: ReactNode }) {
  const now = useServerClock(state?.now);
  const [open, setOpen] = useState(false);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = `${title} · HomePulse`;
  }, [title]);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    drawer.current?.querySelector<HTMLElement>("a,button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "Tab" && drawer.current) {
        const f = [...drawer.current.querySelectorAll<HTMLElement>("a,button,input,select,textarea")].filter((x) => !x.hasAttribute("disabled"));
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) {
          e.preventDefault();
          f[f.length - 1].focus();
        } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
          e.preventDefault();
          f[0].focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      (prev ?? menuBtn.current)?.focus();
    };
  }, [open]);

  return (
    <div className="min-h-dvh">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="glass glass-fog fixed bottom-2 left-2 top-2 z-30 hidden w-[260px] overflow-y-auto rounded-20 lg:block">
        <Sidebar page={page} state={state} nav={nav} />
      </aside>

      {open && (
        <>
          <div className="scrim lg:hidden" onClick={() => setOpen(false)} aria-hidden />
          <div ref={drawer} className="drawer glass glass-marine fixed bottom-2 left-2 top-2 z-[60] w-[min(300px,calc(100vw-56px))] overflow-y-auto rounded-20 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
            <Button variant="gray" size="small" iconOnly icon="close" aria-label="Close menu" className="absolute right-3 top-3.5 z-10" onClick={() => setOpen(false)} />
            <Sidebar page={page} state={state} nav={nav} onNavigate={() => setOpen(false)} />
          </div>
        </>
      )}

      <div className="lg:pl-[276px]">
        <header className="toolbar-wrap">
          <div className="glass glass-fog flex h-14 items-center gap-3 rounded-16 pl-2 pr-3 lg:pl-5">
            <Button ref={menuBtn} variant="plain" iconOnly icon="menu" aria-label="Open menu" aria-expanded={open} className="text-label-1 lg:hidden" onClick={() => setOpen(true)} />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-heading lg:text-title-3">{title}</h1>
              {subtitle && <p className="hidden truncate text-caption text-label-2 xl:block">{subtitle}</p>}
            </div>
            {state && (
              <div className="hidden flex-wrap items-center justify-end gap-1.5 md:flex">
                <HouseTags state={state} />
              </div>
            )}
            <span className="tabular hidden font-mono text-[14px] font-medium text-label-1 sm:inline" aria-label="House time">
              {state ? fmtTime(now, state.tz, true) : "--:--"}
            </span>
            <Live connected={connected} />
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1600px] px-2 pb-10 pt-4 sm:px-4 lg:pl-0 lg:pr-2">
          {state && (
            <div className="mb-3 flex flex-wrap gap-1.5 md:hidden">
              <HouseTags state={state} />
            </div>
          )}
          {children}
        </main>
      </div>
      <ToastHost />
    </div>
  );
}
