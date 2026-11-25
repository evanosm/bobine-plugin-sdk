import { spawn } from "node:child_process";
import { existsSync, readFileSync, watch } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

/** Le script `build` du `package.json`, s'il existe. */
export function buildScript(dir: string): string | null {
  const file = join(dir, "package.json");
  if (!existsSync(file)) return null;
  const pkg = JSON.parse(readFileSync(file, "utf8")) as { scripts?: Record<string, string> };
  return pkg.scripts?.build ?? null;
}

/** Le gestionnaire de paquets du projet, d'après son fichier de verrouillage. */
export function packageManager(dir: string): "pnpm" | "yarn" | "bun" | "npm" {
  if (existsSync(join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(dir, "yarn.lock"))) return "yarn";
  if (existsSync(join(dir, "bun.lock")) || existsSync(join(dir, "bun.lockb"))) return "bun";
  return "npm";
}

/** Un changement de ce fichier doit-il relancer la construction ? (pas ses propres sorties) */
export function triggersBuild(path: string, outputs: string[]): boolean {
  const parts = path.split(/[\\/]/);
  if (parts.some((p) => p.startsWith(".") || p === "node_modules" || p === "dist")) return false;
  if (path.endsWith(".bobine-ext")) return false;
  return !outputs.some((out) => path === out || path.startsWith(`${out}/`));
}

/** Lance le script `build` et attend sa fin. */
export function runBuild(dir: string): Promise<boolean> {
  const pm = packageManager(dir);
  return new Promise((done) => {
    const child = spawn(pm, ["run", "build"], {
      cwd: dir,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", () => done(false));
    child.on("exit", (code) => done(code === 0));
  });
}

/**
 * Reconstruit à chaque changement du dossier (sources, manifeste), une construction à la fois.
 * `outputs` : fichiers et dossiers produits par la construction, à ne pas surveiller.
 */
export function watchAndBuild(
  dir: string,
  outputs: string[],
  onBuilt: (ok: boolean) => void,
): () => void {
  const root = resolve(dir);
  let running = false;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const go = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    do {
      again = false;
      onBuilt(await runBuild(root));
    } while (again);
    running = false;
  };

  const watcher = watch(root, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const path = relative(root, join(root, filename.toString())).split(sep).join("/");
    if (!triggersBuild(path, outputs)) return;
    clearTimeout(timer);
    timer = setTimeout(() => void go(), 150);
  });
  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}
