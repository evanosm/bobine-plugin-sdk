/**
 * CLI `bobine-plugin` : créer, vérifier, empaqueter et essayer une extension de Bobine.
 * Messages en anglais (développeurs du monde entier), comme les erreurs de Bobine.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { accountConfig, login, logout, sessionPath } from "./account";
import { create, defaultSdkSpec, sdkRoot } from "./create";
import { buildScript, packageManager, runBuild, watchAndBuild } from "./dev";
import { type Kind, type Manifest, ManifestError, parsePermission } from "./manifest";
import { pack } from "./pack";
import { checkDir, PackageError } from "./package";
import { catalogUrl, publishFolder } from "./publish";

const log = (line: string) => console.log(line);

/** Questions posées dans le terminal, le temps de `run`. */
async function withPrompt<T>(run: (ask: (q: string) => Promise<string>) => Promise<T>): Promise<T> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await run((question) => rl.question(question));
  } finally {
    rl.close();
  }
}

const HELP = `bobine-plugin: build extensions for Bobine

Usage:
  bobine-plugin create <folder> [--kind plugin|theme|skill] [--id author.name] [--sdk <spec>]
  bobine-plugin check [folder]          check bobine.json and files with Bobine's rules
  bobine-plugin pack [folder] [--out <file>]
                                        check, then write <id>-<version>.bobine-ext
  bobine-plugin dev [folder]            how to load the folder in Bobine; rebuild on change
  bobine-plugin login                   log in to your Bobine account (code by email)
  bobine-plugin logout                  forget the saved session
  bobine-plugin publish [folder] [--yes] [--out <file>]
                                        check, pack and publish to the Bobine marketplace

Environment: BOBINE_SUPABASE_URL, BOBINE_SUPABASE_ANON_KEY, BOBINE_API_URL override
the account server and the marketplace API.

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
      yes: { type: "boolean", short: "y" },
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
    case "login":
      try {
        await withPrompt((ask) =>
          login({ cfg: accountConfig(), sessionFile: sessionPath(), fetchFn: fetch, ask, log }),
        );
        return 0;
      } catch (error) {
        console.error(`error: ${explain(error, dir)}`);
        return 1;
      }
    case "logout": {
      const had = await logout(accountConfig(), sessionPath(), fetch);
      console.log(had ? "Logged out." : "You were not logged in.");
      return 0;
    }
    case "publish": {
      const cfg = accountConfig();
      try {
        const published = await withPrompt((ask) =>
          publishFolder(dir, {
            cfg,
            sessionFile: sessionPath(),
            fetchFn: fetch,
            log,
            ...(values.out ? { out: values.out } : {}),
            confirm: async (question) => {
              if (values.yes) return true;
              if (!process.stdin.isTTY) {
                throw new Error("not a terminal: add --yes to confirm the publication");
              }
              return /^y(es)?$/i.test((await ask(question)).trim());
            },
          }),
        );
        if (!published) {
          console.log("Cancelled: nothing was published.");
          return 0;
        }
        console.log(
          `Published ${published.id} ${published.version} (${published.size} bytes, sha256 ${published.sha256.slice(0, 12)}).` +
            `\nCatalog entry: ${catalogUrl(cfg, published.id)}` +
            "\nIn Bobine: Plugins > Browse extensions...",
        );
        return 0;
      } catch (error) {
        console.error(`error: ${explain(error, dir)}`);
        return 1;
      }
    }
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
