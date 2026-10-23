// Writes .vercel/output (Vercel's Build Output API): one Node.js function that serves every path.
// Run after `npm run build`, which builds the console. Usage: npm run build:vercel
//
// The server is bundled into apps/server/src/ inside the function, so REPO_ROOT (three levels up
// from config.ts) is the function's root and the console, assets and fixtures sit where it expects.
// sharp is native, so it is copied with its dependencies instead of bundled.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, ".vercel/output");
const fn = path.join(output, "functions/index.func");

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(fn, { recursive: true });

await build({
  entryPoints: [path.join(root, "apps/server/src/vercel.ts")],
  outfile: path.join(fn, "apps/server/src/vercel.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  conditions: ["homepulse-source"],
  external: ["sharp"],
  // CommonJS dependencies (express, qrcode) call require() for Node's built-ins.
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
  logLevel: "warning",
});

for (const dir of ["apps/console/dist", "assets", "apps/server/src/demo/fixtures"]) {
  fs.cpSync(path.join(root, dir), path.join(fn, dir), { recursive: true });
}

// sharp and everything it loads, including the platform packages npm installed for this machine.
const copied = new Set();
function copyPackage(name) {
  if (copied.has(name)) return;
  const from = path.join(root, "node_modules", name);
  if (!fs.existsSync(from)) return; // an optional dependency for another platform
  copied.add(name);
  fs.cpSync(from, path.join(fn, "node_modules", name), { recursive: true, dereference: true });
  const pkg = JSON.parse(fs.readFileSync(path.join(from, "package.json"), "utf8"));
  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) copyPackage(dep);
}
copyPackage("sharp");

fs.writeFileSync(
  path.join(fn, ".vc-config.json"),
  JSON.stringify(
    {
      runtime: "nodejs22.x",
      handler: "apps/server/src/vercel.mjs",
      launcherType: "Nodejs",
      // Express parses its own bodies.
      shouldAddHelpers: false,
      supportsResponseStreaming: true,
      // A break-in attempt may take up to BREAK_IT_TIMEOUT_MS (90 s by default).
      maxDuration: 120,
    },
    null,
    2,
  ) + "\n",
);
fs.writeFileSync(
  path.join(output, "config.json"),
  JSON.stringify({ version: 3, routes: [{ src: "/(.*)", dest: "/index" }] }, null, 2) + "\n",
);

console.log(`Wrote ${path.relative(root, output)} (packages copied: ${[...copied].join(", ")})`);
