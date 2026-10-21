import type { ReactNode } from "react";
import type { Lock, State } from "../lib/api";
import { Card, CardHeader, Icon, Tag, type IconName } from "../ui/kit";

function Row({ icon, label, children }: { icon: IconName; label: string; children: ReactNode }) {
  return (
    <div className="row">
      <Icon name={icon} size={20} className="text-label-2" />
      <span className="min-w-0 flex-1 text-body-s">{label}</span>
      {children}
    </div>
  );
}

function LockTag({ lock }: { lock: Lock }) {
  return lock.state === "unlocked" ? (
    <Tag tone="positive" icon="lock_open">
      Unlocked
    </Tag>
  ) : (
    <Tag icon="lock">Locked</Tag>
  );
}

/** The house at a glance: both guarded locks, night mode, lockdown and who is expected. */
export function HouseCard({ state }: { state: State }) {
  const passes = state.passes.filter((p) => p.status === "active");
  return (
    <Card aria-label="House">
      <CardHeader title="House" caption="Simulated devices, real guard">
        <Tag icon="science">Simulated</Tag>
      </CardHeader>
      <div className="group mt-3">
        <Row icon="door_front" label="HomePulse front door">
          <LockTag lock={state.devices.front_door} />
        </Row>
        <Row icon="package_2" label="Parcel box">
          <LockTag lock={state.devices.parcel_box} />
        </Row>
        <Row icon="bedtime" label="Night mode">
          <span className="text-footnote text-label-2">{state.home.night_mode ? `On · ${state.home.night_mode_source === "manual" ? "set by hand" : "by the clock"}` : "Off"}</span>
        </Row>
        <Row icon="shield_lock" label="Lockdown">
          {state.home.away_lockdown ? (
            <Tag tone="caution" icon="lock">
              On
            </Tag>
          ) : (
            <span className="text-footnote text-label-2">Off</span>
          )}
        </Row>
      </div>
      {passes.length > 0 && (
        <>
          <div className="mt-4 text-caption font-semibold text-label-2">Expected today</div>
          <ul className="group mt-2">
            {passes.map((p) => (
              <li key={`${p.who}-${p.window}`} className="row">
                <Icon name="vpn_key" size={18} className="text-tint" fill />
                <span className="min-w-0 flex-1">
                  <span className="block text-body-s font-medium">{p.who}</span>
                  <span className="block text-caption text-label-2">
                    {p.door === "front" ? "Front door" : "Parcel box"} · {p.window}
                    {p.allow_at_night ? " · valid at night" : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
