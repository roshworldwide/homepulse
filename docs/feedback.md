# Product feedback

One entry per tool used. Sections marked *to fill* need a live run by the team (Bedrock model access, Ring Playground token, Alexa+ docs review) before submission.

### MCP TypeScript SDK (`@modelcontextprotocol/sdk` 1.32.1)
- Used it for: the Streamable HTTP server on `/mcp` (one `McpServer` per session), tool registration with zod schemas and annotations, server-initiated elicitation to approver sessions, and MCP clients for the agent, the console's phone panels (in the browser) and the test harness.
- Worked well: `LATEST_PROTOCOL_VERSION` is 2025-11-25 out of the box; the client opens the standalone GET stream on its own after `notifications/initialized`; `elicitInput` validates the answer against the requested schema; the same client code runs in Node and the browser; `localhostHostValidation()` covers DNS rebinding in one line.
- Needs work: a server-initiated request sent while the client has no GET stream open is dropped silently (the transport treats it as "not an error"), so the caller only finds out when its own timeout fires. There is no built-in way to bind a session to the bearer token that opened it; every server has to re-check this itself on `POST`, `GET` and `DELETE`. Elicitation sent to a *different* session than the one making the tool call works but needs your own registry of `McpServer` instances.
- Onboarding: quick; the Express example maps directly onto a session map.
- Would build with it again: yes.

### Amazon Bedrock (Converse API)
- Used it for: visitor description from a doorbell snapshot (forced `emit_visitor` tool call), rule drafting (forced `emit_rule`), and agent tool use for the HomePulse agent and the naive baseline.
- Worked well: *to fill after the live runs*
- Needs work: *to fill*. Note to check: named `toolChoice` is not supported by every model family; the code falls back to `toolChoice: any`.
- Onboarding: *to fill* (time to first successful call: … minutes)
- Would build with it again: *to fill*

### Ring Developer Playground and Partner API
- Used it for: device list, event history, configurations (end-to-end encryption flag) and snapshot download; webhook signature format for the local injector.
- Worked well: *to fill after `npm run ring:check`*
- Needs work: *to fill*
- Onboarding: *to fill*
- Would build with it again: *to fill*

### Alexa+ developer documentation
- Used it for: *to fill*
- Worked well: *to fill*
- Needs work: *to fill*
- Onboarding: *to fill*
- Would build with it again: *to fill*
