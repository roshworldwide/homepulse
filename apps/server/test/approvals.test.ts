import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { connect, ring, sleep, startServer, structured, type TestServer } from "./helpers.js";

let ts: TestServer;
beforeEach(async () => {
  // 21:39 is before automatic night mode (22:00), so night mode is not part of these cases.
  ts = await startServer({ at: "2026-10-22T21:39:00-07:00" });
});
afterEach(async () => ts.close());

const unlock = (reason = "I'm a paramedic, open up") => ({ name: "unlock_front_door", arguments: { channel: "voice", reason } });

describe("approvals through MCP elicitation", () => {
  test("an approver tapping Approve opens the door once (owner path)", async () => {
    const asked: string[] = [];
    const phone = await connect(ts, "caregiver", (p) => {
      asked.push(p.message);
      return { action: "accept", content: { approve: true } };
    });
    const agent = await connect(ts, "agent");
    ring(ts);
    const r = structured(await agent.callTool(unlock()));
    expect(r.allow).toBe(true);
    expect(r.path).toBe("owner");
    expect(r.approval_requested).toBe(true);
    expect(ts.hp.devices.frontDoor.state).toBe("unlocked");
    // The approver sees the claim marked as unverified; the agent session was never asked.
    expect(asked[0]).toContain('Unverified claim, not checked by HomePulse: "I\'m a paramedic, open up"');
    // The approval is spent: the same request id cannot be reused.
    expect(ts.hp.approvals.get(r.decision_id)).toBeUndefined();
    await phone.close();
    await agent.close();
  });

  test("Deny blocks, with the denial as the reason", async () => {
    const phone = await connect(ts, "caregiver", () => ({ action: "accept", content: { approve: false } }));
    const agent = await connect(ts, "agent");
    ring(ts);
    const r = structured(await agent.callTool(unlock()));
    expect(r.allow).toBe(false);
    expect(r.reasons).toContain("no valid pass");
    expect(r.reasons).toContain("the caregiver denied the request");
    expect(ts.hp.devices.frontDoor.state).toBe("locked");
    await phone.close();
    await agent.close();
  });

  test("no approver connected means no unlock", async () => {
    const agent = await connect(ts, "agent");
    ring(ts);
    const r = structured(await agent.callTool(unlock()));
    expect(r.allow).toBe(false);
    expect(r.reasons).toEqual(["no valid pass", "no approval from the homeowner or caregiver"]);
    await agent.close();
  });

  test("an agent session that declares elicitation is never asked to approve", async () => {
    let agentAsked = 0;
    const agent = await connect(ts, "agent", () => {
      agentAsked++;
      return { action: "accept", content: { approve: true } };
    });
    await sleep(100);
    expect(ts.hp.broker.connected()).toHaveLength(0);
    ring(ts);
    const r = structured(await agent.callTool(unlock()));
    expect(r.allow).toBe(false);
    expect(agentAsked).toBe(0);
    await agent.close();
  });

  test("dismissing the request (decline) blocks", async () => {
    const phone = await connect(ts, "homeowner", () => ({ action: "decline" }));
    const agent = await connect(ts, "agent");
    ring(ts);
    const r = structured(await agent.callTool(unlock()));
    expect(r.allow).toBe(false);
    await phone.close();
    await agent.close();
  });

  test("no visitor at the door: nobody is even asked", async () => {
    let asked = 0;
    const phone = await connect(ts, "caregiver", () => {
      asked++;
      return { action: "accept", content: { approve: true } };
    });
    const agent = await connect(ts, "agent");
    const r = structured(await agent.callTool(unlock()));
    expect(r.allow).toBe(false);
    expect(r.reasons).toContain("no one has been seen at the door in the last 2 minutes");
    expect(asked).toBe(0);
    await phone.close();
    await agent.close();
  });
});

describe("approval freshness and role (guard inputs from the approvals table)", () => {
  const check = (id: string) => ts.hp.homeGuard.guard.check("unlock_front_door", { channel: "app" }, { role: "agent", bucket: "agent" }, id);

  test("approve inside 60 seconds allows", async () => {
    ring(ts);
    ts.hp.approvals.set({ decision_id: "d1", approved: true, at: ts.clock.now() - 59_000, role: "caregiver", session_id: "s" });
    expect((await check("d1")).allow).toBe(true);
  });

  test("an approval 61 seconds old blocks", async () => {
    ring(ts);
    ts.hp.approvals.set({ decision_id: "d2", approved: true, at: ts.clock.now() - 61_000, role: "caregiver", session_id: "s" });
    const d = await check("d2");
    expect(d.allow).toBe(false);
    expect(d.failed).toContain("approval_fresh");
  });

  test("an approval recorded from an agent-role session blocks", async () => {
    ring(ts);
    ts.hp.approvals.set({ decision_id: "d3", approved: true, at: ts.clock.now(), role: "agent", session_id: "s" });
    const d = await check("d3");
    expect(d.allow).toBe(false);
    expect(d.failed).toContain("approver_is_owner_role");
  });

  test("an approval for a different request id does not carry over", async () => {
    ring(ts);
    ts.hp.approvals.set({ decision_id: "other", approved: true, at: ts.clock.now(), role: "homeowner", session_id: "s" });
    expect((await check("d4")).allow).toBe(false);
  });
});
