// Bundles the plugin into dist/: one classic script per page (Bobine loads `main` with a plain
// <script>, so no ES modules), plus the panel's HTML and CSS. In this repository the SDK is taken
// from ../../src (tsconfig `paths`); a real plugin uses the installed package.
import { copyFileSync, mkdirSync } from "node:fs";
import { build } from "esbuild";

mkdirSync("dist", { recursive: true });
await build({
  entryPoints: ["src/main.ts", "src/panel.ts"],
  bundle: true,
  format: "iife",
  target: "es2022",
  outdir: "dist",
  logLevel: "info",
});
for (const file of ["panel.html", "panel.css"]) copyFileSync(`src/${file}`, `dist/${file}`);
