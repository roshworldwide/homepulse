# Friction log

Started 21 Oct 2026 (Day 1). Add an entry whenever something in the Amazon / MCP toolchain costs time.

Template:

```markdown
### <Short title>
- Task: …
- Steps taken: …
- Expected: …
- Actual: …
- Severity: critical / important / minor
- Workaround: …
- Suggestion: …
```

## Entries

### A custom "source" export condition broke MCP SDK client imports in tests
- Task: run the server tests with the guard package resolved from TypeScript source via a custom export condition.
- Steps taken: named the condition `source`; ran Vitest on a test that imports `@modelcontextprotocol/sdk/client/streamableHttp.js`.
- Expected: only our workspace package resolves to `src/`.
- Actual: `eventsource-parser` (an SDK dependency) also exports a `source` condition, so Node tried to load its raw `.ts` from `node_modules` and failed with "Stripping types is currently unsupported for files under node_modules".
- Severity: minor
- Workaround: renamed our condition to `homepulse-source`.
- Suggestion: none for the SDK itself; worth a line in monorepo docs that generic condition names collide with dependencies.

### Server-initiated elicitation is dropped silently when the approver has no GET stream
- Task: send an approval request (MCP elicitation) from a blocked tool call to the caregiver's session.
- Steps taken: called `elicitInput` on the caregiver session's `McpServer` from inside the agent session's tool handler.
- Expected: an error if the message cannot be delivered.
- Actual: with no standalone GET stream open on that session, the SDK's Streamable HTTP transport drops the message ("Generally this is not an error") and the request waits until its timeout.
- Severity: important
- Workaround: register a session as an approver only after `notifications/initialized` (when the SDK client opens its GET stream), give every ask a timeout, and treat "no answer" as "no unlock".
- Suggestion: surface an error, or expose whether a standalone stream is open, so servers can fail fast.

### Ring webhook v1.1 payload fields were hard to read from the docs page
- Task: build the local injector so its payloads match Ring's v1.1 webhook shape.
- Steps taken: read the Partner API documentation page for the "Webhook v1.1 Payload Structure" section.
- Expected: a complete example body for `motion_detected` and `button_press`.
- Actual: the signature format (`X-Signature`, `sha256=` + hex HMAC over raw bytes) and event types were clear, but we could not get the full payload example out of the page in text form.
- Severity: minor
- Workaround: the receiver's normaliser tolerates several shapes and keeps unknown attributes; the injector uses a best-effort v1.1 shape (meta + data/attributes + device relationship). To verify against the docs before relying on real webhooks.
- Suggestion: a downloadable JSON Schema or sample payload file per event type.

### App Runner, named in our plan for the public demo, no longer takes new customers
- Task: deploy the "try to break in" page (container, public HTTPS, an IAM role for Bedrock).
- Steps taken: planned App Runner; checked the App Runner documentation before writing the deploy script.
- Expected: `aws apprunner create-service` from a container image.
- Actual: the documentation says App Runner is closed to new customers and recommends Amazon ECS Express Mode.
- Severity: important
- Workaround: deploy with `aws ecs create-express-gateway-service` (one call gives a Fargate service, a load balancer and an HTTPS endpoint). The endpoint's host name is assigned at creation, so the server accepts a `.ecs.<region>.on.aws` suffix in its Host allow-list. See `deploy/aws`.
- Suggestion: a banner on older App Runner tutorials and samples, and an Express Mode equivalent of App Runner's "service URL" field in the create response.

### The default AWS profile's keys were rejected on the night of the live runs
- Task: first Amazon Bedrock call (23 Oct, the night before submission).
- Steps taken: `aws sts get-caller-identity` with the default profile.
- Expected: the IAM user's ARN.
- Actual: `InvalidClientTokenId: The security token included in the request is invalid`. The only profile had old keys.
- Severity: minor
- Workaround: `aws configure` with keys for a dedicated IAM user (`homepulse-dev`). About 5 minutes.
- Suggestion: none for AWS; we now check credentials first, before any model work.

### An inference profile that is listed is already end of life
- Task: pick an Amazon Nova model that takes images and supports Converse tool use.
- Steps taken: `aws bedrock list-inference-profiles --region us-east-1`, then one tiny Converse call (one image, one tool) to each candidate.
- Expected: every listed profile answers.
- Actual: `us.amazon.nova-premier-v1:0` is listed, but the call returns `ResourceNotFoundException: This model version has reached the end of its life`. Nova 2 Lite, Nova Pro and Nova Lite answered with `stopReason: tool_use`.
- Severity: minor
- Workaround: the one-call check before choosing.
- Suggestion: hide end-of-life profiles from the listing, or mark them.

### Nova Pro throttled most Holdout cases, and the quota could not be read
- Task: run the 120-case agent-level Holdout on Nova Pro for the model-agnostic chart.
- Steps taken: `npm run holdout:models -- --models us.amazon.nova-pro-v1:0,... --concurrency 4`.
- Expected: about the same pace as Nova 2 Lite, which ran 581 calls in 153 s with three cases at a time and no errors.
- Actual: 88 of the first 104 Nova Pro cases failed with "Too many requests" after the SDK's retries and two of our own. `aws service-quotas list-service-quotas` was denied for the developer IAM user, so the limit stayed unknown.
- Severity: important
- Workaround: stopped the run (saved cases are kept), then resumed Nova Pro one case at a time.
- Suggestion: name the limit that was hit in the throttling error, or let Bedrock callers read their own model quotas.

### A real model does not follow the scripted golden path
- Task: record the video's fixtures from Amazon Nova 2 Lite.
- Steps taken: `npm run demo -- --all` live, then `npm run demo:record`.
- Expected: the four scenarios as the offline stand-in plays them, where the agents follow the sign and the paramedic so the guard can be seen blocking.
- Actual: Nova 2 Lite declined the paramedic and the sign on its own, in both agents, without calling the door tool. So no decision card appears, and the caregiver is not asked. In the Holdout it also declined 7 of 20 legitimate owner-approval visits before calling the tool, so nobody was asked to approve them.
- Severity: important (it changes what the video shows)
- Workaround: the README shows both, the offline stand-in's path and what the recorded Nova run does, and reports the 7 refusals as measured.
- Suggestion: for us, tell the agent to hand every door request to the guard (which then asks the family) instead of refusing itself, and re-run the Holdout.

### A recorded rule draft did not replay, because the key included seconds
- Task: replay the four scenarios from the new fixtures with no Bedrock call.
- Steps taken: counted Bedrock calls during `npm run demo -- --all` in `DEMO_MODE`.
- Expected: 0 calls.
- Actual: 1 call. The scenario clock ticks after each step, so the live recording reached the nurse's rule draft at 13:40:01 and the replay at 13:40:00, and the fixture key included the seconds.
- Severity: minor
- Workaround: rule fixtures are keyed to the minute; re-recorded, and the replay now makes 0 calls.
- Suggestion: none (our bug).

### A 150-connection test failed on macOS only
- Task: `npm test` on a Mac before pushing.
- Steps taken: ran the stress suite.
- Expected: it passes, as it does on Linux CI.
- Actual: `ECONNRESET` on connect. macOS's default listen backlog (`kern.ipc.somaxconn` = 128) resets a burst of 150 connects.
- Severity: minor
- Workaround: the test connects in batches of 50 and still holds all 150 open at once.
- Suggestion: none (test environment).
