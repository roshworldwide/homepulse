import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../config.js";
import { DraftSchema, VisitorSchema, type DraftContext, type ImageInput, type ModelInfo, type ModelProvider } from "./types.js";

export const FIXTURES_DIR = path.join(REPO_ROOT, "apps/server/src/demo/fixtures");

export interface Fixture<T = unknown> {
  kind: string;
  key: string;
  scenario: string;
  model_id: string;
  recorded_at: string;
  latency_ms: number;
  /** Short human-readable description of the input. */
  input: string;
  output: T;
}

export const sha8 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex").slice(0, 12);

/**
 * Recorded real model outputs, keyed by scenario and step. Written only by
 * `npm run demo:record` from live Bedrock calls, never by hand.
 */
export class FixtureStore {
  constructor(private dir = FIXTURES_DIR) {}

  private file(scenario: string, kind: string, key: string) {
    return path.join(this.dir, scenario, `${kind}-${key}.json`);
  }

  get<T>(scenario: string, kind: string, key: string): Fixture<T> | undefined {
    const f = this.file(scenario, kind, key);
    return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf8")) as Fixture<T>) : undefined;
  }

  put<T>(fx: Fixture<T>): void {
    const f = this.file(fx.scenario, fx.kind, fx.key);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(fx, null, 2) + "\n");
  }

  count(): number {
    if (!fs.existsSync(this.dir)) return 0;
    let n = 0;
    for (const s of fs.readdirSync(this.dir)) {
      const d = path.join(this.dir, s);
      if (fs.statSync(d).isDirectory()) n += fs.readdirSync(d).filter((f) => f.endsWith(".json")).length;
    }
    return n;
  }
}

export const visionKey = (img: ImageInput) => sha8(img.bytes);
export const ruleKey = (utterance: string, ctx: DraftContext) => sha8(`${utterance}|${ctx.now_iso}|${ctx.tz}`);

/**
 * DEMO_MODE provider: replay a recorded real output when one exists for this
 * scenario and input; otherwise call the live provider (and record, when
 * recording); otherwise fall back to the offline stand-in, labelled as such.
 */
export class FixtureProvider implements ModelProvider {
  constructor(
    private store: FixtureStore,
    private scenario: () => string | null,
    private live: ModelProvider | null,
    private fallback: ModelProvider,
    private record: boolean,
  ) {}

  info(): ModelInfo {
    if (this.live) return { ...this.live.info(), label: `${this.live.info().label} (recorded fixtures when present)` };
    return { provider: "fixture", model_id: "recorded", label: this.store.count() ? "Recorded Bedrock outputs (offline stand-in where none)" : "Offline stand-in (not a model) · no fixtures recorded yet" };
  }

  private replayInfo(fx: Fixture): ModelInfo {
    return { provider: "fixture", model_id: fx.model_id, label: `Recorded ${fx.model_id} output (${fx.recorded_at.slice(0, 10)})` };
  }

  async describeVisitor(image: ImageInput) {
    const scenario = this.scenario() ?? "default";
    const key = visionKey(image);
    const fx = this.store.get(scenario, "vision", key) ?? this.store.get("shared", "vision", key);
    if (fx && !this.record) return { output: VisitorSchema.parse(fx.output), info: this.replayInfo(fx), latency_ms: fx.latency_ms };
    if (this.live) {
      const r = await this.live.describeVisitor(image);
      if (this.record) {
        this.store.put({ kind: "vision", key, scenario, model_id: r.info.model_id, recorded_at: new Date().toISOString(), latency_ms: r.latency_ms, input: image.name ?? "image", output: r.output });
      }
      return r;
    }
    return this.fallback.describeVisitor(image);
  }

  async draftRule(utterance: string, ctx: DraftContext) {
    const scenario = this.scenario() ?? "default";
    const key = ruleKey(utterance, ctx);
    const fx = this.store.get(scenario, "rule", key);
    if (fx && !this.record) return { output: DraftSchema.parse(fx.output), info: this.replayInfo(fx), latency_ms: fx.latency_ms };
    if (this.live) {
      const r = await this.live.draftRule(utterance, ctx);
      if (this.record) {
        this.store.put({ kind: "rule", key, scenario, model_id: r.info.model_id, recorded_at: new Date().toISOString(), latency_ms: r.latency_ms, input: `${utterance} @ ${ctx.now_iso}`, output: r.output });
      }
      return r;
    }
    return this.fallback.draftRule(utterance, ctx);
  }
}
