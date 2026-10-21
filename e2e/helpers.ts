import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** Pages reach the server only: no fonts or scripts from anywhere else. */
export async function open(page: Page, path: string) {
  await page.route(/^(?!http:\/\/127\.0\.0\.1).*/, (r) => r.abort());
  await page.goto(path, { waitUntil: "load" });
}

/** Wait until the console's phone has its MCP session, so approvals can reach it. */
export async function phoneReady(page: Page) {
  await expect(page.getByText("MCP session · elicitation").first()).toBeVisible();
}

/** A scenario is done when the sidebar stops showing its spinner. */
export async function scenarioDone(page: Page) {
  await page.waitForFunction(() => !document.querySelector("aside .nav-row .spinner"), undefined, { timeout: 90_000 });
}

export async function tap(page: Page, name: string) {
  const b = page.getByRole("button", { name, exact: true }).first();
  await expect(b).toBeVisible();
  await b.click();
}

/** axe with its default rules (WCAG A and AA plus best practices); returns readable violations. */
export async function axeViolations(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}
