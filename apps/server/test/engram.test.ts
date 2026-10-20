import { describe, expect, test } from "vitest";
import { ControlledClock } from "../src/clock.js";
import { Engram, openDatabase } from "../src/engram/store.js";

const T = (s: string) => Date.parse(s);

function store() {
  const clock = new ControlledClock(T("2026-10-22T13:00:00-07:00"), false);
  return { clock, engram: new Engram(openDatabase(":memory:"), clock) };
}

describe("Engram", () => {
  test("records chain and verify", () => {
    const { engram } = store();
    for (let i = 0; i < 20; i++) engram.append({ kind: "input", source: "system", payload: { i } });
    expect(engram.verify()).toMatchObject({ ok: true, count: 20 });
  });

  test("editing one record by hand makes verify fail at that record", () => {
    const { engram } = store();
    for (let i = 0; i < 10; i++) engram.append({ kind: "input", source: "ring", payload: { i } });
    engram.db.prepare("UPDATE records SET payload = ? WHERE id = 6").run(JSON.stringify({ i: 600 }));
    const r = engram.verify();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.brokenAt).toBe(6);
  });

  test("two timestamps: a note written at 13:05 and synced at 13:40 was not known at 13:20", () => {
    const { clock, engram } = store();
    clock.set(T("2026-10-22T13:20:00-07:00"));
    engram.append({ kind: "decision", source: "system", payload: { decision_id: "d" } });
    clock.set(T("2026-10-22T13:40:00-07:00"));
    const note = engram.append({ kind: "input", source: "caregiver", t_event: T("2026-10-22T13:05:00-07:00"), payload: { note: "Nurse Sarah at 2" } });
    expect(note.t_event).toBe("2026-10-22T20:05:00.000Z");
    expect(note.t_known).toBe("2026-10-22T20:40:00.000Z");
    const at1320 = engram.asOf(T("2026-10-22T13:20:00-07:00"));
    expect(at1320.map((r) => r.kind)).toEqual(["decision"]);
    expect(engram.asOf(T("2026-10-22T13:41:00-07:00"))).toHaveLength(2);
  });

  test("payloads are stored as canonical JSON", () => {
    const { engram } = store();
    engram.append({ kind: "input", source: "system", payload: { b: 1, a: 2 } });
    const raw = engram.db.prepare("SELECT payload FROM records").get() as { payload: string };
    expect(raw.payload).toBe('{"a":2,"b":1}');
  });
});
