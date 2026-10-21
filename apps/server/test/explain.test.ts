import { hashCode, newPassId, signPass } from "mcp-streamable-guard";
import { afterEach, describe, expect, test } from "vitest";
import { AgentService } from "../src/agents/homepulse.js";
import type { AgentModel, ConverseReply, ConverseRequest } from "../src/agents/types.js";
import { askedTime, explain } from "../src/tools/explain_decision.js";
import { connect, ring, startServer, structured, T, type TestServer } from "./helpers.js";

let ts: TestServer;
afterEach(async () => ts?.close());

const TZ = "America/Los_Angeles";
const CODE = "482913";

/** 1:00 PM: an agent request with no one at the door (blocked). 2:14 PM: the nurse's code (allowed). Now: 4 PM. */
async function dayWithTwoDecisions() {
  ts = await startServer({ at: "2026-10-22T13:00:00-07:00" });
  await ts.hp.homeGuard.physical("unlock_front_door", { channel: "agent" }, { role: "agent", bucket: "agent" });
  ts.hp.passes.insert(
    signPass(
      {
        pass_id: newPassId(),
        door: "front",
        who: "Nurse Sarah",
        purpose: "insulin delivery",
        not_before: "2026-10-22T14:00:00-07:00",
        not_after: "2026-10-22T15:00:00-07:00",
        max_uses: 1,
        code_hash: hashCode(CODE, ts.hp.config.codeSecret),
        allow_at_night: false,
        issued_by: "homeowner",
        confirmed_via: "app",
        issued_at: "2026-10-22T13:40:00-07:00",
      },
      ts.hp.keys.privateKey,
    ),
    ts.clock.now(),
  );
  ts.clock.set(T("2026-10-22T14:14:00-07:00"));
  ring(ts);
  const ok = await ts.hp.homeGuard.physical("unlock_front_door", { presented_code: CODE, channel: "keypad" }, { role: "device", bucket: "keypad" });
  expect(ok.decision.allow).toBe(true);
  ts.clock.set(T("2026-10-22T16:00:00-07:00"));
}

describe("explain_decision by time (wow 2)", () => {
  test("parses clock times the way people say them", () => {
    const now = T("2026-10-22T16:00:00-07:00");
    const at = (s: string, bare = false) => {
      const ms = askedTime(s, now, TZ, { bare });
      return ms === null ? null : new Date(ms).toISOString();
    };
    expect(at("what happened at 1 PM?")).toBe("2026-10-22T20:00:00.000Z");
    expect(at("why was it locked at 2:14pm")).toBe("2026-10-22T21:14:00.000Z");
    expect(at("around 13:05")).toBe("2026-10-22T20:05:00.000Z");
    expect(at("at noon")).toBe("2026-10-22T19:00:00.000Z");
    expect(at("at 3")).toBe("2026-10-22T22:00:00.000Z"); // 3 PM: the most recent 3 o'clock
    expect(at("at 5")).toBe("2026-10-22T12:00:00.000Z"); // 5 PM hasn't happened yet, so 5 AM
    expect(at("yesterday at 9 p.m.")).toBe("2026-10-22T04:00:00.000Z");
    expect(at("1 PM", true)).toBe("2026-10-22T20:00:00.000Z");
    expect(at("yesterday 9 pm", true)).toBe("2026-10-22T04:00:00.000Z");
    expect(at("2026-10-22T14:14:00-07:00", true)).toBe("2026-10-22T21:14:00.000Z");
    // Ids and other numbers are not times.
    expect(at("why did dec_0002 stay locked")).toBeNull();
    expect(at("the 3 doors")).toBeNull();
    expect(at("at 25:00")).toBeNull();
    expect(at("garbage", true)).toBeNull();
  });

  test("answers about the request at that time, as HomePulse knew it then", async () => {
    await dayWithTwoDecisions();
    const blocked = "The door stayed locked at 1 PM because no one has been seen at the door in the last 2 minutes, there was no valid pass and there was no approval from the homeowner or caregiver.";
    const s = (q?: string, at?: string) => explain(ts.hp, undefined, q, at).sentence;
    expect(s(undefined, "1 PM")).toBe(blocked);
    expect(s("Why did the door stay locked at 1 PM?")).toBe(blocked);
    expect(s("What happened at 1:10 pm?")).toBe(blocked); // within 30 minutes after the request
    expect(s("Why did the door open at 1 PM?")).toBe(`The door didn't open around 1 PM. ${blocked}`);
    expect(s("What happened at 2:14 PM?")).toBe("The door opened at 2:14 PM because Nurse Sarah's pass matched the code entered at the door.");
    expect(s("Why did the door open at 3?")).toBe("There were no door requests around 3 PM.");
    expect(s(undefined, "9 PM")).toBe("It isn't 9 PM yet.");
    expect(s(undefined, "yesterday 1 pm")).toBe("There were no door requests around 1 PM.");
    expect(s(undefined, "half past one")).toBe('I couldn\'t read "half past one" as a time.');
    // Without a time, the old behaviour stands; a negative question no longer picks the last opening.
    expect(s("Why did the door open?")).toMatch(/^The door opened at 2:14 PM/);
    expect(s("Why didn't the door open?")).toMatch(/^The door opened at 2:14 PM/); // latest decision overall
  });

  test("over MCP: the at field is in the schema and works", async () => {
    await dayWithTwoDecisions();
    const agent = await connect(ts, "agent");
    const tool = (await agent.listTools()).tools.find((t) => t.name === "explain_decision")!;
    expect(Object.keys((tool.inputSchema as { properties: object }).properties)).toEqual(["decision_id", "at", "question"]);
    const r = structured(await agent.callTool({ name: "explain_decision", arguments: { at: "1 PM" } }));
    expect(r.sentence).toMatch(/^The door stayed locked at 1 PM/);
    expect(r.decision_id).toMatch(/^dec_/);
    await agent.close();
  });
});

/** A model that calls explain_decision, then rewords (and embellishes) the answer. */
class ParaphrasingModel implements AgentModel {
  info() {
    return { provider: "offline" as const, model_id: "test-paraphraser", label: "Test paraphraser (not a model)" };
  }
  async converse(req: ConverseRequest): Promise<ConverseReply> {
    const last = req.messages.at(-1)!;
    const isResult = (last.content ?? []).some((c) => "toolResult" in c && c.toolResult);
    if (!isResult) {
      return { stopReason: "tool_use", message: { role: "assistant", content: [{ toolUse: { toolUseId: "t1", name: "explain_decision", input: { question: "why did the door open at 2:14 PM?" } } }] } };
    }
    return { stopReason: "end_turn", message: { role: "assistant", content: [{ text: "Sarah the nurse showed her badge, so I let her in." }] } };
  }
}

describe("explanations are spoken word for word (wow 2)", () => {
  test("a model that rewords the log's sentence is overruled; its wording is kept for the record", async () => {
    await dayWithTwoDecisions();
    const svc = new AgentService(ts.hp, () => ts.url, { homepulse: new ParaphrasingModel(), naive: new ParaphrasingModel() });
    const [r] = await svc.turn("Alexa, why did the door open at 2:14?", "homepulse");
    expect(r.reply).toBe("The door opened at 2:14 PM because Nurse Sarah's pass matched the code entered at the door.");
    expect(r.model_reply).toBe("Sarah the nurse showed her badge, so I let her in.");
    expect(ts.hp.devices.spoken.at(-1)?.text).toBe(r.reply); // what Alexa said aloud
    await svc.close();
  });
});
