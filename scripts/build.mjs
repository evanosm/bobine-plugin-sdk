// Construit dist/ : le SDK en ESM (pour un bundler) et en IIFE (plugin sans bundler, global
// `BobineSDK`), la CLI pour Node, puis les déclarations TypeScript.
import { execFileSync } from "node:child_process";
import { chmodSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
rmSync(dist, { recursive: true, force: true });

const browser = {
  entryPoints: [join(root, "src/index.ts")],
  bundle: true,
  platform: "browser",
  target: "es2022",
  logLevel: "warning",
};
await build({ ...browser, format: "esm", outfile: join(dist, "index.js") });
await build({
  ...browser,
  format: "iife",
  globalName: "BobineSDK",
  outfile: join(dist, "bobine-plugin-sdk.iife.js"),
});
await build({
  entryPoints: [join(root, "src/cli/index.ts")],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  banner: { js: "#!/usr/bin/env node" },
  outfile: join(dist, "cli.js"),
  logLevel: "warning",
});
execFileSync(join(root, "node_modules/.bin/tsc"), ["-p", join(root, "tsconfig.build.json")], {
  stdio: "inherit",
});
chmodSync(join(dist, "cli.js"), 0o755);
console.log("dist/ built");
