import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { loadConfig } from "../src/config.js";

describe("data folder", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hp-config-"));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("HOMEPULSE_DATA_DIR=memory keeps everything in memory", () => {
    const c = loadConfig({ HOMEPULSE_DATA_DIR: "memory" });
    expect(c.dataDir).toBeNull();
    expect(c.tokens.homeowner).toMatch(/^[0-9a-f]{64}$/);
  });

  test("HOMEPULSE_DATA_DIR moves the folder, and tokens persist there", () => {
    const a = loadConfig({ HOMEPULSE_DATA_DIR: dir });
    expect(a.dataDir).toBe(dir);
    expect(fs.existsSync(path.join(dir, "tokens.json"))).toBe(true);
    expect(loadConfig({ HOMEPULSE_DATA_DIR: dir }).tokens.homeowner).toBe(a.tokens.homeowner);
  });

  test("an explicit option still wins over the environment", () => {
    expect(loadConfig({ HOMEPULSE_DATA_DIR: dir }, { dataDir: null }).dataDir).toBeNull();
  });
});
