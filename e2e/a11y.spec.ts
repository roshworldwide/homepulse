import { expect, test } from "@playwright/test";
import { axeViolations, open } from "./helpers";

// Every page, light and dark, desktop and phone: no axe violations (WCAG A/AA and best practices).
for (const scheme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    for (const path of ["/console", "/alexa", "/break-it"]) {
      test(`accessibility: ${path} · ${scheme} · ${width} px`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize({ width, height: 900 });
        await open(page, path);
        await page.waitForTimeout(1200);
        expect(await axeViolations(page)).toEqual([]);
      });
    }
  }
}
