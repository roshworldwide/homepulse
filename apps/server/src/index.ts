import { loadConfig, loadDotEnv } from "./config.js";
import { createHomePulse } from "./context.js";
import { createApp } from "./http.js";
import { extensions } from "./extensions.js";

loadDotEnv();
const config = loadConfig();
const hp = createHomePulse(config);
const { app } = createApp(hp, extensions(hp));

app.listen(config.port, config.host, () => {
  const model = hp.provider.info();
  console.log(`HomePulse MCP server on http://${config.host}:${config.port}/mcp (protocol 2025-11-25, Streamable HTTP)`);
  console.log(`Console: http://localhost:5173/console (dev) · Model: ${model.label}${config.demoMode ? " · DEMO_MODE" : ""}`);
  console.log(`Role tokens are in .env or data/tokens.json. Engram: ${config.dataDir ?? "memory"}/homepulse.db`);
});
