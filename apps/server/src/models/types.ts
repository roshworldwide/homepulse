import { z } from "zod";

/** What the vision step may return. All of it reaches the agent as untrusted data; none of it sets a guard input. */
export const VisitorSchema = z.object({
  people_count: z.number().int().min(0).max(20).nullable(),
  carrying: z.array(z.string().max(120)).max(10),
  uniform_or_badge: z.object({ visible: z.boolean(), text: z.string().max(200).nullable() }),
  visible_text: z.array(z.string().max(500)).max(10),
  package_present: z.boolean().nullable(),
  summary: z.string().max(400),
});
export type VisitorDescription = z.infer<typeof VisitorSchema>;

/** What the rule drafter must return. The server validates it and applies its own limits. */
export const DraftSchema = z.object({
  who: z.string().min(1).max(80),
  door: z.enum(["front", "parcel_box"]),
  not_before: z.string().nullable(),
  not_after: z.string().nullable(),
  max_uses: z.literal(1),
  allow_at_night: z.boolean(),
  purpose: z.string().max(120).nullable(),
  needs_clarification: z.string().max(200).nullable(),
  /** What the rule's condition rests on. Only pass_code or owner_approval are acceptable. */
  depends_on: z.array(z.string().max(40)).max(5),
});
export type RuleDraftRaw = z.infer<typeof DraftSchema>;

export interface ModelInfo {
  /** bedrock = a live model call; fixture = a recorded real model output; offline = local stand-in, not a model. */
  provider: "bedrock" | "fixture" | "offline";
  model_id: string;
  label: string;
}

export interface ImageInput {
  bytes: Buffer;
  mime: "image/jpeg" | "image/png";
  /** Snapshot file name, used to key recorded fixtures and offline sidecars. */
  name?: string;
}

export interface DraftContext {
  now_iso: string;
  tz: string;
  weekday: string;
}

export interface ModelProvider {
  info(): ModelInfo;
  describeVisitor(image: ImageInput): Promise<{ output: VisitorDescription; info: ModelInfo; latency_ms: number }>;
  draftRule(utterance: string, ctx: DraftContext): Promise<{ output: RuleDraftRaw; info: ModelInfo; latency_ms: number }>;
}
