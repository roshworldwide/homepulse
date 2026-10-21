# Stress test report

Run on 21 Oct 2026 on a 2-core Intel Xeon (2.10 GHz), Node 22.22. Everything below was measured; the raw load-test output is in [stress-load-memory.md](stress-load-memory.md) and [stress-load-file.md](stress-load-file.md).

## What was run

| Suite | What it does | Result |
| --- | --- | --- |
| Model-based test (`test/stress/model.test.ts`) | 3,000 random sequences of up to 60 real operations (issue passes, move the clock, ring, night mode, lockdown, keypad, agent unlocks with right/wrong/forged credentials and injected text, owner taps, tampering with a stored pass), about 8,700 door requests through the real guard path, each compared with an oracle written independently of the guard | 0 disagreements. Every failure mode was exercised (each of the 14 inputs failed at least 10 times). No pass used twice, chain always intact, no code in the log |
| HTTP fuzzing (`test/stress/fuzz-http.test.ts`) | 600 runs per property: random JSON-RPC bodies, methods and params on `/mcp`; random tool arguments through a real MCP client; malformed, oversized (2 MB), 20,000-deep and batch bodies; signed and unsigned random webhooks (plus 50,000-deep nesting and impossible timestamps); random bodies on every REST route; adversarial input for regex backtracking | No 5xx, no HTML error page, no stack trace, no door opened |
| Races and limits (`test/stress/races.test.ts`) | One pass hit 24 times at once across keypad and agent; the same draft confirmed twice at once; two phones answering at the same moment; phones that vanish, blip and reconnect; 6 agent turns at once; 200 sessions opened and closed; idle expiry and per-role caps; 150 live views; 600 owner taps and 600 drafts; keypad flood; throwing listeners; failures while logging; rate limits with repeated ids; agent reconnects | All pass (25 tests) |
| Remote exposure (`test/stress/security.test.ts`) | Server bound to `0.0.0.0` and reached via its LAN address | Console, live view, log, agent and demo routes need a homeowner or caregiver token; tokens are never handed out remotely; DNS-rebinding Host headers get 403; pages cannot be framed |
| Load test (`npm run stress:load`) | 50 concurrent MCP sessions × 40 calls, a 1,000-request keypad race on one pass, a 2,000-event signed webhook flood, live-view clients, and query latency on a 106,249-record log | All checks pass (numbers below) |
| Crash test | `kill -9` three times in the middle of a webhook flood against the on-disk database, then `engram:verify` | Chain intact every time; every webhook answered 200 was stored |
| Independent review | A separate review of every change, with a test for each claim | 8 issues found, all fixed with regression tests (marked R below) |

## Defects found and fixed

**Safety and security**

1. Requests with malformed JSON got Express's HTML error page with a stack trace and file paths. Now: JSON only, JSON-RPC `-32700` on `/mcp`, no internals.
2. `/demo/reset` ran outside `DEMO_MODE`. Without any token it lifted a lockdown and cancelled every pass. Now: `DEMO_MODE` only, and off-machine it needs a homeowner or caregiver token.
3. With `HOST` set to anything but loopback, anyone on the network could read the live view, the log, and the visitor's text message with the door code. Now those routes need a homeowner or caregiver token from anywhere but the machine itself.
4. Listening beyond loopback allowed DNS rebinding. Now the Host header is checked against localhost, this machine's names and addresses, and `ALLOWED_HOSTS`.
5. The console could be framed, so the Approve button could be clickjacked. Now `X-Frame-Options: DENY` and `frame-ancestors 'none'` are set.
6. If logging an approval failed, the approval still counted. Now it is logged before it can count, and any error while asking the phones keeps the request blocked. (R)
7. If asking the phones threw, the tool call failed with no decision on record. Now it fails closed and the decision is still logged.
8. A live-view listener that threw could fail a door decision after the pass was consumed. Now listeners are isolated.
9. Rate limiting undercounted when demo ids repeated after a restart. It now counts by log record, not by request id.
10. JSON-RPC batch bodies were accepted, although MCP 2025-11-25 removed batching. Now they get `400`.

**Reliability**

11. The Ring webhook answered 200 before storing the event. 20 of 2,672 events were lost when the process was killed. Now the event is stored first and then acknowledged. Database errors answer 503 so Ring resends, and resends are de-duplicated only after a successful store. (R)
12. A webhook timestamp such as `1e20` threw while storing the event. Impossible times now fall back to "now".
13. Rule drafting threw a schema error on long names or purposes. A model or schema error now gives "I couldn't turn that into a rule".
14. Asking a phone that had gone away held the door request for the full 45-second timeout. Phones are now tracked by their live stream. A stream drop gets a 5-second grace period to reconnect, so a network blip no longer costs an approval. (R)
15. If the phone that confirmed a rule left before the code could be shown, a pass existed that nobody could use. That pass is now cancelled and the family is told.
16. If logging failed after the door had opened, the reply said the door "stayed locked". The reply now reflects what happened. (R)
17. The agent never reconnected after its MCP session disappeared. It now reconnects once and retries.
18. Two background promises (confirming a caregiver note, showing the code) had no error handler. They are now caught. The server also logs any stray rejection, and exits on an uncaught exception so a supervisor can restart it.
19. The server had no graceful shutdown. SIGTERM and SIGINT now end sessions, flush the WAL and close the log.

**Resources**

20. Sessions never expired and had no cap. Idle sessions now expire, but never while a request or stream is open. Each role has its own cap with least-recently-used eviction, so agent sessions cannot crowd out the family's phones. (R)
21. Approvals, drafts, the visitor text messages and the rate-limiter maps grew without bound. They are now swept or capped.
22. Live view had three problems: a listener-leak warning past 100 clients, unbounded buffering for clients that stop reading, and one JSON serialization per client. It is now capped at 100 clients, drops a client that falls 4 MB behind (EventSource reconnects with a fresh snapshot), and serializes each event once.
23. The keypad HTTP endpoint had no throttle. It now allows 20 requests a minute per address.

**Performance**

24. The guard's queries scanned whole time windows or the whole log, and SQLite also chose the wrong index. The fix uses partial and expression indexes, names them explicitly in the hot queries, uses targeted queries, caches prepared statements, and verifies the chain as a stream. Measured on a 106,249-record log:

| Call | Before | After (p50) |
| --- | --- | --- |
| `unlock_front_door` | 592 ms | 2.3 ms |
| `describe_visitor` | 942 ms | 1.8 ms |
| `explain_decision` | 1,355 ms | 1.3 ms |
| `get_door_events` | 580 ms | 2.0 ms |
| Console "as of" view | 1,690 ms (returned the whole log) | 5.2 ms (last 500) |
| Console "Why?" panel | (read the whole log) | 0.7 ms (`/api/why`) |
| Keypad race throughput | 81 decisions/s | 1,684 decisions/s |
| Memory after the full load test | 1,435 MB RSS | 368 MB RSS |

## Numbers after the fixes

| Load | In-memory SQLite | On-disk SQLite (WAL, fsync per write) |
| --- | --- | --- |
| 50 MCP sessions × 40 calls | 383 calls/s, 0 errors, p50 68 ms | 347 calls/s, 0 errors |
| Keypad race (200 right codes for one pass) | 1 door opening, 1,684 decisions/s | 1 door opening, 507 decisions/s |
| Signed webhook flood (2,000) | 0 non-200, 2,000 stored, max reply 99 ms | 0 non-200, 2,000 stored, max reply 612 ms |

## Known limits (accepted, documented)

- **Session-start burst:** when 50 MCP sessions connect at the same instant, their first calls reach about 2.5–3 s at p99 while each session's tools are set up. After that, p99 was 169 ms with the server and clients in separate processes.
- **Keypad lockout:** the keypad allows 5 attempts per 10 minutes in total, like a real keypad lockout. A stranger can lock it for 10 minutes. The caregiver is alerted on every block and can still approve from the phone.
- **Rate limiting by address:** behind a reverse proxy, every client shares one address.
- **No real model in these runs:** stress runs use the offline stand-in. The guard does not depend on the model, but the agent-level Holdout still needs a run against Bedrock.
