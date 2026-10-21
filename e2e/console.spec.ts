import { expect, test } from "@playwright/test";
import { open, phoneReady, scenarioDone, tap } from "./helpers";

test.describe.configure({ mode: "serial" });

test("the four scenarios, the Why? panel and time travel", async ({ page }) => {
  await open(page, "/console");
  await phoneReady(page);
  const decision = page.locator("section[aria-live]").first();

  // 1 · Nurse visit: the caregiver confirms the rule, a code goes to the nurse, the keypad lets her in.
  await page.keyboard.press("1");
  await tap(page, "Confirm");
  await tap(page, "Send to visitor");
  await expect(page.getByText("Keypad: ALLOWED.")).toBeVisible();
  await expect(decision.getByRole("heading", { name: "Allowed" })).toBeVisible();
  await scenarioDone(page);

  // Why? replays the log and flips inputs with the same guard code.
  await page.getByRole("button", { name: "Why?" }).click();
  const why = page.locator("#why-panel");
  await expect(why.getByText("What HomePulse knew")).toBeVisible();
  await expect(why.locator("li").first()).toBeVisible();
  await why.getByRole("switch", { name: "The pass signature verifies" }).click();
  await expect(why.getByText("Blocked", { exact: true })).toBeVisible();
  await expect(why.getByText(/1 input changed/)).toBeVisible();
  await why.getByRole("button", { name: "Reset" }).click();
  await expect(why.getByText("Allowed", { exact: true })).toBeVisible();

  // Time travel: step back and the log is replayed as known then; the far right is live again.
  const scrub = page.locator("#scrub");
  await scrub.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByText(/exactly what HomePulse knew then/)).toBeVisible();
  await page.keyboard.press("End");
  await expect(page.getByText(/exactly what HomePulse knew then/)).toBeHidden();
  await scrub.blur();

  // 2 · Shouted paramedic at night: the caregiver denies; the unguarded baseline opens its door.
  await page.keyboard.press("2");
  await tap(page, "Deny");
  await expect(decision.getByRole("heading", { name: "Blocked" })).toBeVisible();
  await expect(decision.getByText("The caregiver denied the request")).toBeVisible();
  await expect(page.getByLabel("Baseline: no HomePulse").getByText("Unlocked")).toBeVisible();
  await scenarioDone(page);

  // 3 · A sign held to the camera: blocked, and the echoed text is called out.
  await page.keyboard.press("3");
  await expect(page.getByText("This request repeats text from the camera.")).toBeVisible();
  await expect(decision.getByText("No valid pass")).toBeVisible();
  await expect(page.getByLabel("Front door camera").getByText("Untrusted")).toBeVisible();
  await scenarioDone(page);

  // 4 · Night check-in from the hall sensor: nobody is let in.
  await page.keyboard.press("4");
  await expect(page.getByText(/Dad is at the front door from inside/).first()).toBeVisible();
  await scenarioDone(page);
  await expect(page.getByLabel("House").getByText("Locked").first()).toBeVisible();

  // The log still verifies after all of it.
  await page.getByRole("button", { name: "Verify chain" }).click();
  await expect(page.getByText(/Chain intact/)).toBeVisible();
});

test("appearance: Dark is applied, remembered, and Auto follows the system", async ({ page }) => {
  await open(page, "/console");
  const html = page.locator("html");
  await page.getByRole("button", { name: "Dark" }).first().click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Match the system" }).first().click();
  await expect(html).toHaveAttribute("data-theme", "light");
});
