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
