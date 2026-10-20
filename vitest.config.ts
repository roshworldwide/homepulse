import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { conditions: ["homepulse-source"] },
  ssr: { resolve: { conditions: ["homepulse-source"], externalConditions: ["homepulse-source"] } },
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/server/test/**/*.test.ts", "harness/test/**/*.test.ts"],
    passWithNoTests: true,
    testTimeout: 30_000,
  },
});
