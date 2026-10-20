import type { Config } from "../config.js";
import { OfflineProvider } from "./offline.js";
import type { ModelProvider } from "./types.js";

/** Pick the model provider from config. Bedrock and recorded fixtures are added in models/bedrock.ts and models/fixtures.ts. */
export function makeProvider(config: Config, _scenario: () => string | null): ModelProvider {
  return new OfflineProvider();
}
