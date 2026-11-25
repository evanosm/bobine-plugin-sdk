/**
 * Fichiers d'un dossier d'extension et contenus vérifiés (thème, skill), selon les règles de
 * Bobine (`crates/extensions/src/package.rs`, `theme.rs`, `skill.rs`).
 */
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  hasControl,
  isSafePath,
  MANIFEST_FILE,
  type Manifest,
  ManifestError,
  manifestWarnings,
  readManifest,
  validateManifest,
} from "./manifest";

export const MAX_FILES = 2_000;
export const MAX_FILE_BYTES = 128 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
export const MAX_SKILL_BYTES = 16 * 1024;
const MAX_TOKENS = 200;
const MAX_VALUE = 80;

/** Paquet refusé (taille, nombre de fichiers, chemin) : comme `ExtError::Package`. */
export class PackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackageError";
  }
}

export type PackageFile = { path: string; full: string; size: number };

/**
 * Les fichiers d'un dossier tels que Bobine les voit : fichiers cachés (`.git`, `.DS_Store`),
 * `node_modules` et liens symboliques ignorés ; chemins sûrs ; tailles plafonnées.
 */
export function listFiles(root: string): PackageFile[] {
  const out: PackageFile[] = [];
  let total = 0;
  const walk = (dir: string, prefix: string) => {
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith(".") || name === "node_modules") continue;
      const full = join(dir, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      const stat = lstatSync(full);
      if (stat.isDirectory()) walk(full, relative);
      else if (stat.isFile()) {
        if (!isSafePath(relative)) throw new PackageError(`unsafe path \`${relative}\``);
        if (stat.size > MAX_FILE_BYTES) throw new PackageError(`\`${relative}\` is too big`);
        total += stat.size;
        if (total > MAX_TOTAL_BYTES) throw new PackageError("package is too big");
        if (out.length >= MAX_FILES) throw new PackageError("too many files");
        out.push({ path: relative, full, size: stat.size });
      }
    }
  };
  walk(root, "");
  return out;
}

// --- Thème (`theme.rs`) -------------------------------------------------------------------------

const isName = (rest: string) => rest.length > 0 && /^[a-z0-9-]+$/.test(rest);

function isColor(value: string): boolean {
  if (value === "transparent") return true;
  if (value.startsWith("#")) {
    const hex = value.slice(1);
    return [3, 4, 6, 8].includes(hex.length) && /^[0-9a-fA-F]+$/.test(hex);
  }
  if (value.startsWith("var(--color-") && value.endsWith(")")) {
    return isName(value.slice("var(--color-".length, -1));
  }
  return ["oklch(", "rgb(", "rgba(", "hsl(", "hsla("].some((prefix) => {
    if (!value.startsWith(prefix) || !value.endsWith(")")) return false;
    const inner = value.slice(prefix.length, -1);
    return inner.trim() !== "" && /^[0-9 .%,/\-deg]+$/.test(inner);
  });
}

function parseFloatStrict(text: string): number | null {
  return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text) ? Number(text) : null;
}

function isLength(value: string): boolean {
  if (value === "0") return true;
  const match = /^(.*?)(px|rem)$/.exec(value);
  if (!match) return false;
  const n = parseFloatStrict(match[1] ?? "");
  const scale = match[2] === "rem" ? 16 : 1;
  return n !== null && Number.isFinite(n) && n >= 0 && n * scale <= 64;
}

function checkToken(token: string, raw: string): void {
  const value = raw.trim();
  let ok: boolean;
  if (token.startsWith("--color-") && isName(token.slice(8))) ok = isColor(value);
  else if (token === "--gray-hue" || token === "--gray-chroma") {
    const n = parseFloatStrict(value);
    ok = n !== null && Number.isFinite(n) && n >= 0 && n <= 360;
  } else if (token.startsWith("--radius-") && isName(token.slice(9))) ok = isLength(value);
  else throw new ManifestError("theme", `token \`${token}\` cannot be themed`);
  if (!ok || value.length > MAX_VALUE) {
    throw new ManifestError("theme", `\`${token}\`: value \`${value}\` is not allowed`);
  }
}

/** Vérifie un fichier de thème : `{ light: {token: valeur}, dark: {…} }`, liste fermée de tokens. */
export function checkTheme(bytes: Buffer): void {
  let json: unknown;
  try {
    json = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new ManifestError("theme", (error as Error).message);
  }
  const modes: Record<string, string>[] = [];
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new ManifestError("theme", "expected { light, dark }");
  }
  for (const mode of ["light", "dark"] as const) {
    const values = (json as Record<string, unknown>)[mode];
    if (values === undefined) continue;
    if (
      typeof values !== "object" ||
      values === null ||
      Array.isArray(values) ||
      Object.values(values).some((v) => typeof v !== "string")
    ) {
      throw new ManifestError("theme", `\`${mode}\` must be an object of strings`);
    }
    modes.push(values as Record<string, string>);
  }
  const count = modes.reduce((n, m) => n + Object.keys(m).length, 0);
  if (count === 0) throw new ManifestError("theme", "no token");
  if (count > MAX_TOKENS) throw new ManifestError("theme", "too many tokens");
  for (const mode of modes)
    for (const [token, value] of Object.entries(mode)) checkToken(token, value);
}

// --- Skill (`skill.rs`) -------------------------------------------------------------------------

/** Vérifie les consignes d'un skill : UTF-8, 16 Ko au plus, sans caractère de contrôle. */
export function checkSkill(bytes: Buffer): void {
  if (bytes.length > MAX_SKILL_BYTES) throw new ManifestError("skill", "16 KB at most");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ManifestError("skill", "not UTF-8");
  }
  if (hasControl(text, "\n\t\r")) {
    throw new ManifestError("skill", "control characters are not allowed");
  }
  if (text.trim() === "") throw new ManifestError("skill", "empty");
}

// --- Vérification complète d'un dossier --------------------------------------------------------

export type CheckResult = { manifest: Manifest; files: PackageFile[]; warnings: string[] };

/** Vérifie un dossier comme Bobine avant de l'installer. Lève `ManifestError` ou `PackageError`. */
export function checkDir(root: string): CheckResult {
  const files = listFiles(root);
  const manifestFile = files.find((f) => f.path === MANIFEST_FILE);
  if (!manifestFile) throw new PackageError("bobine.json is missing at the root");
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(manifestFile.full, "utf8"));
  } catch (error) {
    throw new ManifestError(MANIFEST_FILE, (error as Error).message);
  }
  const manifest = readManifest(json);
  validateManifest(manifest, new Set(files.map((f) => f.path)));
  if (manifest.kind === "theme" && manifest.theme) {
    checkTheme(readFileSync(join(root, manifest.theme)));
  }
  if (manifest.kind === "skill" && manifest.skill) {
    checkSkill(readFileSync(join(root, manifest.skill)));
  }
  return { manifest, files, warnings: manifestWarnings(manifest) };
}
