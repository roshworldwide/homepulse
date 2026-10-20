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
