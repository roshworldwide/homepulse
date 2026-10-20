import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { conditions: ["source"] },
  ssr: { resolve: { conditions: ["source"], externalConditions: ["source"] } },
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/server/test/**/*.test.ts", "harness/test/**/*.test.ts"],
    passWithNoTests: true,
    testTimeout: 30_000,
  },
});
