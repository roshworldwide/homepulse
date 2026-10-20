import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { connect, sleep, startServer, structured, type TestServer } from "./helpers.js";

let ts: TestServer;
beforeEach(async () => {
  ts = await startServer({ at: "2026-10-22T13:40:00-07:00" });
});
afterEach(async () => ts.close());

describe("voice-written rules", () => {
  test("spoken rule -> draft and read-back -> tap Confirm -> signed pass; the code never reaches the agent", async () => {
    const seen: string[] = [];
    const phone = await connect(ts, "homeowner", (p) => {
      seen.push(p.message);
      const field = Object.keys((p as { requestedSchema: { properties: object } }).requestedSchema.properties)[0];
      return { action: "accept", content: { [field]: true } };
    });
    const agent = await connect(ts, "agent");

    const draft = structured(await agent.callTool({ name: "propose_rule", arguments: { utterance: "Alexa, let Nurse Sarah in today between 2 and 3 for Dad's insulin. She'll have a code." } }));
    expect(draft.status).toBe("draft");
    expect(draft.read_back).toBe("Allow Nurse Sarah through the front door once, today 2 to 3 PM, with a code. Confirm in the app.");
    expect(ts.hp.passes.all()).toHaveLength(0);

    const confirmed = await agent.callTool({ name: "confirm_rule", arguments: { draft_id: draft.draft_id } });
    const c = structured(confirmed);
    expect(c.status).toBe("confirmed");
    expect(c.window).toBe("today 2 to 3 PM");
    // No six-digit code and no pass id anywhere in what the agent got back.
    expect(JSON.stringify(confirmed)).not.toMatch(/\b\d{6}\b/);
    expect(JSON.stringify(confirmed)).not.toMatch(/pass_[0-9a-f]{16}/);

    const rows = ts.hp.passes.all();
    expect(rows).toHaveLength(1);
    expect(rows[0].pass).toMatchObject({ who: "Nurse Sarah", door: "front", max_uses: 1, allow_at_night: false, issued_by: "homeowner", confirmed_via: "app" });

    // The code was shown once, on the homeowner's phone only.
    await sleep(200);
    const codeMsg = seen.find((m) => m.startsWith("One-time code for Nurse Sarah:"));
    expect(codeMsg).toMatch(/\d{6}/);
    // "Send to visitor" was tapped: the simulated SMS went out.
    expect(ts.hp.devices.sms.at(-1)?.to).toBe("Nurse Sarah");
    expect(ts.hp.devices.tvCards.some((c) => c.title === "Expected today: Nurse Sarah, 2 to 3 PM")).toBe(true);
    await phone.close();
    await agent.close();
  });

  test("a declined rule signs nothing", async () => {
    const phone = await connect(ts, "caregiver", () => ({ action: "accept", content: { confirm: false } }));
    const agent = await connect(ts, "agent");
    const d = structured(await agent.callTool({ name: "propose_rule", arguments: { utterance: "Let the plumber Joe in tomorrow from 9 to 11 am" } }));
    expect(d.status).toBe("draft");
    expect(d.read_back).toContain("tomorrow 9 to 11 AM");
    const c = structured(await agent.callTool({ name: "confirm_rule", arguments: { draft_id: d.draft_id } }));
    expect(c.status).toBe("declined");
    expect(ts.hp.passes.all()).toHaveLength(0);
    await phone.close();
    await agent.close();
  });

  test("vague timing asks one question instead of drafting", async () => {
    const agent = await connect(ts, "agent");
    const r = structured(await agent.callTool({ name: "propose_rule", arguments: { utterance: "Let Nurse Sarah in sometime tomorrow" } }));
    expect(r.status).toBe("needs_clarification");
    expect(r.question).toMatch(/what time/i);
    await agent.close();
  });

  test("unsafe rules are refused and the nearest safe rule is offered", async () => {
    const agent = await connect(ts, "agent");
    // A caregiver note puts Nurse Sarah's visit on record first.
    await ts.hp.compiler.propose("Nurse Sarah and cold-chain insulin arriving at 2 PM", "caregiver");
    const r = structured(await agent.callTool({ name: "propose_rule", arguments: { utterance: "Let in anyone in a nurse's uniform" } }));
    expect(r.status).toBe("refused");
    expect(r.why).toBe("Anyone can wear a uniform.");
    expect(r.offer).toBe("I can give Nurse Sarah a one-time code for 1:45 to 3 PM instead. Want that?");
    expect(r.offer_draft_id).toMatch(/^draft_/);

    for (const u of ["Always let the Amazon guy in", "Let in whoever says they are from the gas company", "Let my son in any night"]) {
      expect(structured(await agent.callTool({ name: "propose_rule", arguments: { utterance: u } })).status).toBe("refused");
    }
    await agent.close();
  });

  test("allow_at_night only when said in words, and the read-back says it", async () => {
    const r1 = await ts.hp.compiler.propose("Let Priya in tonight between 9 and 11 pm", "homeowner");
    expect(r1.status).toBe("draft");
    if (r1.status === "draft") {
      expect(r1.draft.allow_at_night).toBe(false);
      expect(r1.read_back).toContain("Night mode starts at 10 PM");
    }
    const r2 = await ts.hp.compiler.propose("Let Priya in tonight between 9 and 11 pm, even at night", "homeowner");
    if (r2.status === "draft") {
      expect(r2.draft.allow_at_night).toBe(true);
      expect(r2.read_back).toContain("even at night");
    } else throw new Error("expected a draft");
  });

  test("windows longer than 12 hours are rejected", async () => {
    const r = await ts.hp.compiler.propose("Let Joe in tomorrow from 6 am to 9 pm", "homeowner");
    expect(r.status).toBe("invalid");
  });
});

describe("caregiver note (stands in for a Bee recording)", () => {
  test("a note written at 13:05 and synced at 13:40 becomes a caregiver-confirmed pass, with both timestamps", async () => {
    const phone = await connect(ts, "caregiver", (p) => {
      const field = Object.keys((p as { requestedSchema: { properties: object } }).requestedSchema.properties)[0];
      return { action: "accept", content: { [field]: field === "confirm" } };
    });
    const r = await fetch(`${ts.base}/api/caregiver/note`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ts.token("caregiver")}` },
      body: JSON.stringify({ text: "Nurse Sarah and cold-chain insulin arriving at 2 PM", written_at: "2026-10-22T13:05:00-07:00" }),
    });
    const body = (await r.json()) as { status: string };
    expect(body.status).toBe("draft");
    for (let i = 0; i < 50 && ts.hp.passes.all().length === 0; i++) await sleep(20);
    expect(ts.hp.passes.all()[0].pass).toMatchObject({ who: "Nurse Sarah", issued_by: "caregiver" });
    const note = ts.hp.engram.all().find((x) => x.payload.type === "rule_utterance")!;
    expect(note.source).toBe("caregiver");
    expect(note.t_event).toBe("2026-10-22T20:05:00.000Z");
    expect(note.t_known).not.toBe(note.t_event);
    // Without the caregiver token the route refuses.
    const no = await fetch(`${ts.base}/api/caregiver/note`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${ts.token("agent")}` }, body: JSON.stringify({ text: "x y z" }) });
    expect(no.status).toBe(401);
    await phone.close();
  });
});
