import type { Config } from "../config.js";
import { BedrockProvider } from "./bedrock.js";
import { FixtureProvider, FixtureStore } from "./fixtures.js";
import { OfflineProvider } from "./offline.js";
import type { ModelProvider } from "./types.js";

/**
 * MODEL_PROVIDER=bedrock -> live Amazon Bedrock.
 * MODEL_PROVIDER=offline -> the labelled offline stand-in (no AWS needed).
 * DEMO_MODE=true wraps either: recorded fixtures first, keyed by scenario and step.
 */
export function makeProvider(config: Config, scenario: () => string | null): ModelProvider {
  const offline = new OfflineProvider();
  const live = config.modelProvider === "bedrock" ? new BedrockProvider(config.bedrockModelId, config.awsRegion) : null;
  if (config.demoMode) return new FixtureProvider(new FixtureStore(), scenario, live, offline, process.env.RECORD_FIXTURES === "1");
  return live ?? offline;
}
