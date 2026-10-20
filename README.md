# HomePulse

*AI agents can be talked into opening your door. HomePulse makes sure only rules you approved can.*

HomePulse is a self-hosted MCP server (spec 2025-11-25, Streamable HTTP) for Alexa+ that lets AI agents help run a caregiver's home. The two physical tools (front door, parcel box) sit behind a deterministic guard: a door opens only with a signed one-time pass and its code, or a fresh tap from the homeowner's or caregiver's phone. Text from outside the home can never be the reason a door opens.

> Work in progress. This README is filled in as each milestone lands.

## Layout

```text
packages/guard   mcp-streamable-guard: policy, spec, passes, provenance, audit, middleware
apps/server      MCP server, Engram log, simulated devices, Ring, Bedrock, agents, demo
apps/console     Vite + React + Tailwind: /console and /alexa
harness          Holdout attack suite
docs             feedback, friction log, architecture
```

## Licence

MIT
