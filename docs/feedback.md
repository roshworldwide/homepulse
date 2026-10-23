# Product feedback

One entry per tool used, written on 23 Oct 2026 from the build and from the live Amazon Bedrock runs that night. The Ring Developer Playground and Alexa+ were not run live for this submission; their entries say what the build used instead.

## AWS services used and how

- **Amazon Bedrock (Converse API)** runs every model call in HomePulse, through the AWS SDK for JavaScript v3 (`@aws-sdk/client-bedrock-runtime`) in us-east-1. **Amazon Nova 2 Lite** (`us.amazon.nova-2-lite-v1:0`) describes the doorbell snapshot through a forced `emit_visitor` tool call, drafts visitor rules through a forced `emit_rule` tool call, and drives both agents (HomePulse and the naive baseline), with the MCP server's tools handed to the model as Converse `toolSpec`s. The same Converse code ran the agent-level Holdout on **Amazon Nova 2 Lite, Amazon Nova Pro and Amazon Nova Lite** (US cross-region inference profiles), and Nova 2 Lite's live runs were recorded as the fixtures the demo video replays.
- **AWS IAM:** a dedicated IAM user (`homepulse-dev`) for the local runs. For the public break-in page, `deploy/aws` defines an ECS task role that may only call `bedrock:InvokeModel`.
- **Amazon ECS Express Mode, Amazon ECR and AWS Budgets:** `deploy/aws/deploy.sh` builds and pushes the image to ECR, creates the Express Mode service with its HTTPS endpoint, and adds a daily budget alarm. It is written from the AWS CLI documentation and was **not run** for this submission.

### MCP TypeScript SDK (`@modelcontextprotocol/sdk` 1.32.1)
- Used it for: the Streamable HTTP server on `/mcp` (one `McpServer` per session), tool registration with zod schemas and annotations, server-initiated elicitation to approver sessions, and MCP clients for the agent, the console's phone panels (in the browser) and the test harness.
- Worked well: `LATEST_PROTOCOL_VERSION` is 2025-11-25 out of the box; the client opens the standalone GET stream on its own after `notifications/initialized`; `elicitInput` validates the answer against the requested schema; the same client code runs in Node and the browser; `localhostHostValidation()` covers DNS rebinding in one line.
- Needs work: a server-initiated request sent while the client has no GET stream open is dropped silently (the transport treats it as "not an error"), so the caller only finds out when its own timeout fires. There is no built-in way to bind a session to the bearer token that opened it; every server has to re-check this itself on `POST`, `GET` and `DELETE`. Elicitation sent to a *different* session than the one making the tool call works but needs your own registry of `McpServer` instances.
- Onboarding: quick; the Express example maps directly onto a session map.
- Would build with it again: yes.

### Amazon Bedrock (Converse API) with Amazon Nova
- Used it for: visitor description from a doorbell snapshot (forced `emit_visitor`), rule drafting (forced `emit_rule`), and tool use for the HomePulse agent and the naive baseline. On 23 Oct 2026: the four golden-path scenarios live, the recorded fixtures for the video (20 calls), and the agent-level Holdout (120 cases, both agents) on three Nova models.
- Worked well:
  - One API for every model. Moving between Nova 2 Lite, Nova Pro and Nova Lite was a change to `BEDROCK_MODEL_ID`, with no code change.
  - Images go in the same message as text, as raw bytes. The first check, one doorbell image plus one tool, came back with `stopReason: tool_use` on Nova 2 Lite (2.7 s) and Nova Pro (2.4 s). Nova 2 Lite also copied the sign's text into `visible_text`, which the sign scenario depends on.
  - Every response carries `usage`, so cost was counted from the responses themselves: the Nova 2 Lite Holdout was 581 calls, 1,184,038 input and 25,289 output tokens, 0 errors, in 153 s with three cases at a time.
- Needs work:
  - `list-inference-profiles` still lists `us.amazon.nova-premier-v1:0`, but calling it returns `ResourceNotFoundException: This model version has reached the end of its life`. Listings could hide end-of-life profiles or mark them.
  - Throttling limits were invisible until we hit them. Nova Pro through its US cross-region profile throttled 88 of 104 Holdout cases at four cases in parallel ("Too many requests"), even after the SDK's and our own retries, while Nova 2 Lite ran three in parallel with no errors. A developer IAM user with Bedrock access could not read its own quotas (`servicequotas:ListServiceQuotas` is a separate permission). The throttling error could name the limit it hit.
  - Named `toolChoice` is not supported by every model family, so the code keeps a fallback to `toolChoice: any`.
- Onboarding: about 5 minutes from working credentials to the first successful image plus tool-use call, and under 15 minutes to the first full live run of the four scenarios. The code was written against the Converse API before any model access, and it ran unchanged.
- Would build with it again: yes. Converse with tool use and images is the whole model layer, and because the guard never depends on the model, choosing a model is a setting.

### Ring Developer Playground and Partner API
- Used it for: the Partner API client (device list, event history, configurations with the end-to-end-encryption flag, snapshot download), built from the documentation and covered by `npm run ring:check`; the webhook receiver; and a local injector that signs events like Ring does. **The Playground was not run live for this submission**, so nothing here describes a live call.
- Worked well: the webhook signature format is clear and easy to implement exactly: `X-Signature` carries `sha256=` plus a hex HMAC-SHA256 over the raw body bytes. The receiver checks it before parsing, replies `200` only once the event is stored (inside Ring's 5-second limit), answers `503` so Ring resends when the database cannot take the write, and is idempotent on `meta.request_id`. The [Computer Vision Guidelines](https://developer.amazon.com/docs/ring/computer-vision-guidelines.html) ("Never treat VLM output as ground truth") matched the design, so the snapshot description goes to the agent as untrusted data and never into the guard.
- Needs work: we could not get a complete example body for `motion_detected` and `button_press` out of the "Webhook v1.1 Payload Structure" section in text form. The injector therefore uses a best-effort v1.1 shape (meta, data and attributes, device relationship), and the receiver tolerates several shapes and keeps unknown attributes. Its field names still need checking against Ring's docs before relying on real webhooks. A downloadable JSON Schema or a sample payload file per event type would close this gap.
- Onboarding: the client and receiver were built from the docs alone. Time to a first live Playground call was not measured, because no live call was made.
- Would build with it again: yes. The signed webhook and the Partner API are a clean fit for an MCP server; we would want sample payloads first.

### Alexa+ and the MCP documentation
- Used it for: the target integration. HomePulse is the self-hosted MCP server (spec 2025-11-25, Streamable HTTP) that an Alexa+ agent connects to; the MCP specification and the TypeScript SDK docs defined the transport, sessions, tool annotations and elicitation. For this submission the Alexa+ voice front end is simulated: the `/alexa` page, labelled "Alexa+ (simulated experience)", calls the real agent and MCP server. No live Alexa+ device or account was connected.
- Worked well: building to the MCP specification let the whole server be built and tested without Alexa+ access, with MCP Inspector, our own MCP clients and the browser pages. Tool annotations (`readOnlyHint`, `destructiveHint`, `openWorldHint`) describe the read tools and the two physical tools directly.
- Needs work: we did not test against a live Alexa+, so we cannot say how Alexa+ handles elicitation or session ids. HomePulse does not depend on it: approvals go to the homeowner's and caregiver's own MCP sessions, never through the agent's.
- Onboarding: no live Alexa+ connection was set up, so there is no time-to-first-success to report.
- Would build with it again: yes. Because the contract is MCP, the same server works with any MCP client, including the simulated page, the test harness and the guard's proxy.
