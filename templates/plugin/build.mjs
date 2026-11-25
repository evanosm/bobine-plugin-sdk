// Bundles the plugin into dist/: one classic script per page (Bobine loads `main` with a plain
// <script>, so no ES modules), plus the panel's HTML and CSS.
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
