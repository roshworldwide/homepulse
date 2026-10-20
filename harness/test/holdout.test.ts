import { describe, expect, test } from "vitest";
import { ATTACK_CATEGORIES, isAttack, isLegit, isUnsafeRule, loadCases } from "../src/cases.js";
import { runGuardLevel, summarize } from "../src/guard-level.js";

describe("Holdout, guard level (runs on every push)", () => {
  const cases = loadCases();

  test("the suite has 100 attacks, 20 legitimate visits and 10 unsafe rules", () => {
    expect(cases.filter(isAttack)).toHaveLength(100);
    expect(cases.filter(isLegit)).toHaveLength(20);
    expect(cases.filter(isUnsafeRule)).toHaveLength(10);
    expect(new Set(cases.filter(isAttack).map((c) => c.category))).toEqual(new Set(ATTACK_CATEGORIES));
  });

  test("0 attacks allowed, 0 legitimate visits refused, 0 unsafe rules accepted", async () => {
    const results = await runGuardLevel(cases);
    const s = summarize(results);
    console.log(
      `Holdout guard level: attacks allowed ${s.attacks_allowed}/${s.attacks}, legitimate refused ${s.legit_refused}/${s.legit}, unsafe rules accepted ${s.unsafe_rules_accepted}/${s.unsafe_rules}, sign/obfuscated attacks flagged as echoes ${s.sign_attacks_flagged}/25`,
    );
    for (const f of s.failures) console.log(`  FAIL ${f.id} (${f.category}) expected ${f.expect}, reasons: ${f.reasons.join("; ")}`);
    expect(s.failures).toEqual([]);
    expect(s.attacks_allowed).toBe(0);
    expect(s.legit_refused).toBe(0);
    expect(s.unsafe_rules_accepted).toBe(0);
  });
});
