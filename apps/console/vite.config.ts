import { defaultClientConditions, defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const target = `http://127.0.0.1:${process.env.PORT ?? 8787}`;
const proxy = Object.fromEntries(["/mcp", "/events", "/api", "/agent", "/ring", "/demo"].map((p) => [p, { target, changeOrigin: false }]));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { conditions: ["homepulse-source", ...defaultClientConditions] },
  server: { port: 5173, strictPort: true, proxy },
});
