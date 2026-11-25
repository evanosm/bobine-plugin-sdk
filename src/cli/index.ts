/**
 * CLI `bobine-plugin` : créer, vérifier, empaqueter et essayer une extension de Bobine.
 * Messages en anglais (développeurs du monde entier), comme les erreurs de Bobine.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { create, defaultSdkSpec, sdkRoot } from "./create";
import { buildScript, packageManager, runBuild, watchAndBuild } from "./dev";
import { type Kind, type Manifest, ManifestError, parsePermission } from "./manifest";
import { pack } from "./pack";
import { checkDir, PackageError } from "./package";

const HELP = `bobine-plugin: build extensions for Bobine

Usage:
  bobine-plugin create <folder> [--kind plugin|theme|skill] [--id author.name] [--sdk <spec>]
  bobine-plugin check [folder]          check bobine.json and files with Bobine's rules
  bobine-plugin pack [folder] [--out <file>]
                                        check, then write <id>-<version>.bobine-ext
  bobine-plugin dev [folder]            how to load the folder in Bobine; rebuild on change
  bobine-plugin publish                 not available yet (marketplace)

Options:
  -h, --help       show this help
  -v, --version    show the SDK version
`;

function version(): string {
  const pkg = JSON.parse(readFileSync(join(sdkRoot(), "package.json"), "utf8")) as {
    version: string;
  };
  return pkg.version;
}

function describePermission(text: string): string {
  const p = parsePermission(text);
  switch (p.type) {
    case "project_read":
      return "reads the project";
    case "project_write":
      return "changes the project (always undoable)";
    case "media_frames":
      return "reads decoded frames of clips";
    case "native_worker":
      return "runs its native program (Genez plugins only in v1)";
    case "network":
      return `talks to ${p.domain}`;
  }
}

function kb(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function summary(m: Manifest, files: number, bytes: number): string {
  const lines = [`${m.id} ${m.version} (${m.kind}): ${m.name.en}`];
  if (m.permissions.length > 0) {
    lines.push(`  permissions: ${m.permissions.map(describePermission).join(", ")}`);
  }
  const c = m.contributes;
  const parts = [
    c.commands.length > 0 && `${c.commands.length} command(s)`,
    c.panels.length > 0 && `${c.panels.length} panel(s)`,
    c.settings.length > 0 && `${c.settings.length} setting(s)`,
  ].filter(Boolean);
  if (parts.length > 0) lines.push(`  contributes: ${parts.join(", ")}`);
  lines.push(`  ${files} file(s), ${kb(bytes)}`);
  return lines.join("\n");
}

/** Message d'erreur lisible, avec un indice quand le code n'est pas encore construit. */
function explain(error: unknown, dir: string): string {
  if (error instanceof ManifestError) {
    let text = `invalid ${error.field}: ${error.message}`;
    if (error.field === "files" && buildScript(dir)) {
      text += `\nhint: run your build first (${packageManager(dir)} run build)`;
    }
    return text;
  }
  if (error instanceof PackageError) return `package refused: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

function printWarnings(warnings: string[]): void {
  for (const w of warnings) console.warn(`warning: ${w}`);
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      kind: { type: "string" },
      id: { type: "string" },
      sdk: { type: "string" },
      out: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  const [command, target] = positionals;
  if (values.version) {
    console.log(version());
    return 0;
  }
  if (values.help || !command || command === "help") {
    console.log(HELP);
    return command || values.help ? 0 : 1;
  }
  const dir = resolve(target ?? ".");

  switch (command) {
    case "create": {
      if (!target) {
        console.error(`error: missing <folder>\n\n${HELP}`);
        return 1;
      }
      const kind = (values.kind ?? "plugin") as Kind;
      const sdk = values.sdk ?? defaultSdkSpec();
      const files = create(target, { kind, sdk, ...(values.id ? { id: values.id } : {}) });
      console.log(`Created a ${kind} in ${dir}:`);
      for (const f of files) console.log(`  ${f}`);
      if (sdk.startsWith("file:")) {
        const where = kind === "plugin" ? `package.json uses the local copy (${sdk})` : "";
        console.log(
          `\nNote: the SDK is not on npm yet${where ? `; ${where}` : ""}.` +
            "\nThe CI template (.github/workflows/bobine.yml) needs the published package.",
        );
      }
      const cli = sdk.startsWith("file:")
        ? `node ${join(sdkRoot(), "dist/cli.js")}`
        : "npx --package=bobine-plugin-sdk bobine-plugin";
      const next =
        kind === "plugin"
          ? ["pnpm install", "pnpm build", "pnpm check"]
          : [`${cli} check`, `${cli} pack`];
      console.log(`\nNext:\n  cd ${target}\n${next.map((n) => `  ${n}`).join("\n")}`);
      return 0;
    }
    case "check": {
      try {
        const result = checkDir(dir);
        const bytes = result.files.reduce((n, f) => n + f.size, 0);
        console.log(`ok  ${summary(result.manifest, result.files.length, bytes)}`);
        printWarnings(result.warnings);
        return 0;
      } catch (error) {
        console.error(`error: ${explain(error, dir)}`);
        return 1;
      }
    }
    case "pack": {
      try {
        const result = pack(dir, values.out);
        printWarnings(result.warnings);
        console.log(`packed  ${summary(result.manifest, result.count, result.bytes)}`);
        console.log(`  -> ${result.archive}`);
        return 0;
      } catch (error) {
        console.error(`error: ${explain(error, dir)}`);
        return 1;
      }
    }
    case "dev":
      return dev(dir);
    case "publish":
      console.log(
        "Publishing is not available yet: it arrives with the Bobine marketplace.\n" +
          "Until then, a theme or a skill can be shared as the archive made by\n" +
          "`bobine-plugin pack` (Bobine installs it, marked as not verified).\n" +
          "A plugin needs the marketplace signature: without it, Bobine only loads\n" +
          "it in developer mode (Plugins > Load an extension in development...).",
      );
      return 0;
    default:
      console.error(`error: unknown command \`${command}\`\n\n${HELP}`);
      return 1;
  }
}

async function dev(dir: string): Promise<number> {
  const build = buildScript(dir);
  if (build) {
    console.log(`Building (${packageManager(dir)} run build)...`);
    await runBuild(dir);
  }
  let manifest: Manifest;
  try {
    const result = checkDir(dir);
    manifest = result.manifest;
    console.log(
      `ok  ${summary(
        manifest,
        result.files.length,
        result.files.reduce((n, f) => n + f.size, 0),
      )}`,
    );
    printWarnings(result.warnings);
  } catch (error) {
    console.error(`error: ${explain(error, dir)}`);
    return 1;
  }
  console.log(`
To try it in Bobine:
  1. Menu Plugins > Load an extension in development...
     (French: Plugins > Charger une extension en développement…)
  2. Choose this folder: ${dir}
  Bobine reads the files from this folder (marked as developer mode).
  After a rebuild, reopen the panel or turn the plugin off and on in "My extensions".
  After a change to bobine.json, load the folder again.`);
  if (!build) {
    console.log("\nNo `build` script in package.json: nothing to rebuild.");
    return 0;
  }
  const outputs = [manifest.main, manifest.ui]
    .filter((p): p is string => p !== null)
    .map((p) => p.split("/").slice(0, -1).join("/") || p);
  console.log("\nWatching for changes (Ctrl+C to stop)...");
  watchAndBuild(dir, outputs, (ok) => {
    const result = (() => {
      try {
        checkDir(dir);
        return "check ok";
      } catch (error) {
        return `check failed: ${explain(error, dir)}`;
      }
    })();
    console.log(ok ? `rebuilt, ${result}` : "build failed");
  });
  return new Promise<number>(() => undefined);
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  },
);
