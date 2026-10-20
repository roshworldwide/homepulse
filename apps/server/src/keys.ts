import fs from "node:fs";
import path from "node:path";
import { exportKeys, generateSigningKeys, importKeys, type SigningKeys } from "mcp-streamable-guard";

/** Ed25519 key pair, created on first run in data/keys/ (git-ignored). In-memory when dataDir is null. */
export function loadOrCreateKeys(dataDir: string | null): SigningKeys {
  if (!dataDir) return generateSigningKeys();
  const dir = path.join(dataDir, "keys");
  const priv = path.join(dir, "ed25519.private.pem");
  const pub = path.join(dir, "ed25519.public.pem");
  if (fs.existsSync(priv) && fs.existsSync(pub)) {
    return importKeys({ privateKeyPem: fs.readFileSync(priv, "utf8"), publicKeyPem: fs.readFileSync(pub, "utf8") });
  }
  const keys = generateSigningKeys();
  const pem = exportKeys(keys);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(priv, pem.privateKeyPem, { mode: 0o600 });
  fs.writeFileSync(pub, pem.publicKeyPem);
  return keys;
}
