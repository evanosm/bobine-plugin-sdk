/**
 * Validation du manifeste `bobine.json`, recopiée des règles de Bobine
 * (`crates/extensions/src/manifest.rs`) : un manifeste que `check` accepte, Bobine l'accepte.
 * Les messages (anglais) et les noms de champ sont ceux de Bobine.
 */

export const MANIFEST_FILE = "bobine.json";
/** Version de l'API de plugin que Bobine sait charger. */
export const API_VERSION = "1";
export const KINDS = ["plugin", "theme", "skill"] as const;
export const PLATFORMS = [
  "darwin-arm64",
  "darwin-x64",
  "windows-x64",
  "linux-x64",
  "linux-arm64",
] as const;
export const MENUS = ["plugins", "clip", "timeline"] as const;
export const PANEL_PLACES = ["library", "inspector"] as const;

export type Kind = (typeof KINDS)[number];
export type Localized = Record<string, string>;

export type Setting =
  | { type: "toggle"; id: string; label: Localized; default: boolean }
  | { type: "number"; id: string; label: Localized; default: number; min: number; max: number }
  | { type: "choice"; id: string; label: Localized; default: string; choices: string[] }
  | { type: "text"; id: string; label: Localized; default: string };

export type Manifest = {
  id: string;
  kind: Kind;
  name: Localized;
  description: Localized;
  author: string;
  version: string;
  api: string;
  engines: { bobine: string };
  permissions: string[];
  contributes: {
    commands: { id: string; title: Localized }[];
    panels: { id: string; title: Localized; where: (typeof PANEL_PLACES)[number] }[];
    menus: Record<string, string[]>;
    settings: Setting[];
  };
  main: string | null;
  ui: string | null;
  native: Record<string, string>;
  theme: string | null;
  skill: string | null;
  icon: string | null;
};

/** Manifeste refusé : `field` dit lequel, `message` pourquoi (comme `ExtError::Invalid`). */
export class ManifestError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "ManifestError";
  }
}

function invalid(field: string, message: string): ManifestError {
  return new ManifestError(field, message);
}

// --- Lecture (équivalent de la désérialisation serde) -------------------------------------------

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shapeError(message: string): ManifestError {
  return invalid(MANIFEST_FILE, message);
}

function str(obj: Json, key: string, path: string, fallback?: string): string {
  const value = obj[key];
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "string") throw shapeError(`\`${path}\` must be a string`);
  return value;
}

function optStr(obj: Json, key: string): string | null {
  const value = obj[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw shapeError(`\`${key}\` must be a string or null`);
  return value;
}

function num(obj: Json, key: string, path: string): number {
  const value = obj[key];
  if (typeof value !== "number") throw shapeError(`\`${path}\` must be a number`);
  return value;
}

function stringMap(value: unknown, path: string, required: boolean): Record<string, string> {
  if (value === undefined && !required) return {};
  if (!isObject(value)) throw shapeError(`\`${path}\` must be an object of strings`);
  for (const v of Object.values(value)) {
    if (typeof v !== "string") throw shapeError(`\`${path}\` must be an object of strings`);
  }
  return value as Record<string, string>;
}

function stringList(value: unknown, path: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw shapeError(`\`${path}\` must be a list of strings`);
  }
  return value as string[];
}

function list(value: unknown, path: string): Json[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => !isObject(v))) {
    throw shapeError(`\`${path}\` must be a list of objects`);
  }
  return value as Json[];
}

function readSetting(s: Json): Setting {
  const path = "contributes.settings";
  const id = str(s, "id", `${path}.id`);
  const label = stringMap(s.label, `${path}.label`, true);
  switch (s.type) {
    case "toggle":
      if (typeof s.default !== "boolean")
        throw shapeError(`setting \`${id}\`: default must be a boolean`);
      return { type: "toggle", id, label, default: s.default };
    case "number":
      return {
        type: "number",
        id,
        label,
        default: num(s, "default", `${path}.default`),
        min: num(s, "min", `${path}.min`),
        max: num(s, "max", `${path}.max`),
      };
    case "choice":
      return {
        type: "choice",
        id,
        label,
        default: str(s, "default", `${path}.default`),
        choices: stringList(s.choices ?? null, `${path}.choices`),
      };
    case "text":
      return { type: "text", id, label, default: str(s, "default", `${path}.default`) };
    default:
      throw shapeError(`setting \`${id}\`: type must be toggle, number, choice or text`);
  }
}

/** Lit le JSON brut : types des champs, valeurs par défaut (comme serde). */
export function readManifest(json: unknown): Manifest {
  if (!isObject(json)) throw shapeError("the manifest must be a JSON object");
  const kind = json.kind;
  if (!KINDS.includes(kind as Kind)) throw shapeError("`kind` must be plugin, theme or skill");
  const engines = json.engines === undefined ? {} : json.engines;
  if (!isObject(engines)) throw shapeError("`engines` must be an object");
  const contributes = json.contributes === undefined ? {} : json.contributes;
  if (!isObject(contributes)) throw shapeError("`contributes` must be an object");
  const menus = contributes.menus === undefined ? {} : contributes.menus;
  if (!isObject(menus)) throw shapeError("`contributes.menus` must be an object");

  return {
    id: str(json, "id", "id"),
    kind: kind as Kind,
    name: stringMap(json.name, "name", true),
    description: stringMap(json.description, "description", false),
    author: str(json, "author", "author", ""),
    version: str(json, "version", "version"),
    api: str(json, "api", "api"),
    engines: { bobine: str(engines, "bobine", "engines.bobine", "") },
    permissions: stringList(json.permissions, "permissions"),
    contributes: {
      commands: list(contributes.commands, "contributes.commands").map((c) => ({
        id: str(c, "id", "contributes.commands.id"),
        title: stringMap(c.title, "contributes.commands.title", true),
      })),
      panels: list(contributes.panels, "contributes.panels").map((p) => {
        if (!PANEL_PLACES.includes(p.where as (typeof PANEL_PLACES)[number])) {
          throw shapeError("`contributes.panels.where` must be library or inspector");
        }
        return {
          id: str(p, "id", "contributes.panels.id"),
          title: stringMap(p.title, "contributes.panels.title", true),
          where: p.where as (typeof PANEL_PLACES)[number],
        };
      }),
      menus: Object.fromEntries(
        Object.entries(menus).map(([menu, entries]) => [
          menu,
          stringList(entries ?? null, `contributes.menus.${menu}`),
        ]),
      ),
      settings: list(contributes.settings, "contributes.settings").map(readSetting),
    },
    main: optStr(json, "main"),
    ui: optStr(json, "ui"),
    native: stringMap(json.native, "native", false),
    theme: optStr(json, "theme"),
    skill: optStr(json, "skill"),
    icon: optStr(json, "icon"),
  };
}

// --- Règles (équivalent de `Manifest::validate`) ------------------------------------------------

/** `auteur.nom` : deux segments en minuscules, chiffres et tirets, 64 caractères au plus. */
export function isExtensionId(id: string): boolean {
  const segment = (s: string) =>
    s.length > 0 && !s.startsWith("-") && !s.endsWith("-") && /^[a-z0-9-]+$/.test(s);
  const parts = id.split(".");
  return id.length <= 64 && parts.length === 2 && parts.every(segment);
}

/** Caractère de contrôle (catégorie Unicode Cc, comme `char::is_control` en Rust), sauf `allowed`. */
export function hasControl(text: string, allowed = ""): boolean {
  for (const c of text) {
    const code = c.codePointAt(0) ?? 0;
    if ((code <= 0x1f || (code >= 0x7f && code <= 0x9f)) && !allowed.includes(c)) return true;
  }
  return false;
}

/** Chemin relatif sous la racine du paquet : ni absolu, ni `..`, ni `\`, ni lecteur Windows. */
export function isSafePath(path: string): boolean {
  return (
    path.length > 0 &&
    Buffer.byteLength(path) <= 200 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.includes(":") &&
    !hasControl(path) &&
    path.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

function isDomain(domain: string): boolean {
  const labels = domain.split(".");
  return (
    domain.length <= 253 &&
    labels.length >= 2 &&
    labels.every(
      (l) =>
        l.length > 0 &&
        l.length <= 63 &&
        !l.startsWith("-") &&
        !l.endsWith("-") &&
        /^[a-z0-9-]+$/.test(l),
    )
  );
}

export type Permission =
  | { type: "project_read" }
  | { type: "project_write" }
  | { type: "media_frames" }
  | { type: "native_worker" }
  | { type: "network"; domain: string };

/** Liste FERMÉE : une permission inconnue refuse le manifeste. */
export function parsePermission(text: string): Permission {
  switch (text) {
    case "project:read":
      return { type: "project_read" };
    case "project:write":
      return { type: "project_write" };
    case "media:frames":
      return { type: "media_frames" };
    case "native:worker":
      return { type: "native_worker" };
  }
  if (text.startsWith("network:")) {
    const domain = text.slice("network:".length);
    if (isDomain(domain)) return { type: "network", domain };
  }
  throw invalid("permissions", `unknown permission \`${text}\``);
}

const NUM = "(?:0|[1-9]\\d*)";
const PRE = "(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)";
const SEMVER = new RegExp(
  `^${NUM}\\.${NUM}\\.${NUM}(?:-${PRE}(?:\\.${PRE})*)?(?:\\+[0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*)?$`,
);

export function isSemver(version: string): boolean {
  return SEMVER.test(version);
}

/** Plage au format du crate Rust `semver` : comparateurs séparés par des virgules (`>=0.4.0, <1`). */
export function isSemverRange(range: string): boolean {
  const comparators = range.split(",").map((c) => c.trim());
  if (comparators.length === 1 && /^[*xX]$/.test(comparators[0] ?? "")) return true;
  const part = "(?:0|[1-9]\\d*|[*xX])";
  const comparator = new RegExp(
    `^(?:=|>=|<=|>|<|~|\\^)?\\s*${NUM}(?:\\.${part}(?:\\.${part}(?:-${PRE}(?:\\.${PRE})*)?)?)?$`,
  );
  return comparators.every((c) => comparator.test(c));
}

function checkLocalized(field: string, text: Localized, max: number): void {
  if ((text.en ?? "").trim() === "") throw invalid(field, "an `en` text is required");
  for (const [language, value] of Object.entries(text)) {
    const known = /^[a-z]{2}$/.test(language);
    if (!known || [...value].length > max || hasControl(value)) {
      throw invalid(
        field,
        `\`${language}\`: two-letter language, ${max} characters at most, no control characters`,
      );
    }
  }
}

function checkLocalId(field: string, id: string, seen: Set<string>): void {
  const valid = id.length > 0 && id.length <= 40 && /^[a-z0-9-]+$/.test(id);
  if (!valid || seen.has(id)) throw invalid(field, `id \`${id}\` is invalid or repeated`);
  seen.add(id);
}

function isDefaultContributions(c: Manifest["contributes"]): boolean {
  return (
    c.commands.length === 0 &&
    c.panels.length === 0 &&
    Object.keys(c.menus).length === 0 &&
    c.settings.length === 0
  );
}

/** Applique les règles de Bobine. `files` : chemins présents dans le paquet. */
export function validateManifest(m: Manifest, files: ReadonlySet<string>): void {
  if (!isExtensionId(m.id)) {
    throw invalid("id", "expected `author.name` in lowercase letters, digits and dashes");
  }
  if (!isSemver(m.version)) throw invalid("version", "expected semver, e.g. 1.2.0");
  if (m.engines.bobine.trim() !== "" && !isSemverRange(m.engines.bobine)) {
    throw invalid("engines.bobine", "expected a semver range");
  }
  checkLocalized("name", m.name, 60);
  if (Object.keys(m.description).length > 0) checkLocalized("description", m.description, 400);
  if ([...m.author].length > 80) throw invalid("author", "80 characters at most");
  const permissions = m.permissions.map(parsePermission);

  const cited = [m.main, m.ui, m.theme, m.skill, m.icon, ...Object.values(m.native)].filter(
    (p): p is string => p !== null,
  );
  for (const path of cited) {
    if (!isSafePath(path) || !files.has(path)) {
      throw invalid("files", `\`${path}\` is missing or not a relative path inside the package`);
    }
  }

  if (m.kind === "plugin" && m.main === null) {
    throw invalid("main", "a plugin needs its `main` script");
  }
  if (m.kind === "theme" && m.theme === null) {
    throw invalid("theme", "a theme needs its `theme` file");
  }
  if (m.kind === "skill" && m.skill === null) {
    throw invalid("skill", "a skill needs its `skill` file");
  }
  if (
    m.kind !== "plugin" &&
    (m.main !== null ||
      m.ui !== null ||
      Object.keys(m.native).length > 0 ||
      m.permissions.length > 0 ||
      !isDefaultContributions(m.contributes))
  ) {
    throw invalid("kind", "only a plugin can run code, declare permissions or contributions");
  }
  const native = Object.keys(m.native);
  if (native.length > 0 && !permissions.some((p) => p.type === "native_worker")) {
    throw invalid("native", "a native worker needs the `native:worker` permission");
  }
  for (const platform of native) {
    if (!(PLATFORMS as readonly string[]).includes(platform)) {
      throw invalid("native", `unknown platform \`${platform}\``);
    }
  }
  validateContributions(m.contributes);
}

function validateContributions(c: Manifest["contributes"]): void {
  const ids = new Set<string>();
  for (const command of c.commands) {
    checkLocalId("contributes.commands", command.id, ids);
    checkLocalized("contributes.commands.title", command.title, 60);
  }
  for (const panel of c.panels) {
    checkLocalId("contributes.panels", panel.id, ids);
    checkLocalized("contributes.panels.title", panel.title, 40);
  }
  const commands = new Set(c.commands.map((x) => x.id));
  for (const [menu, entries] of Object.entries(c.menus)) {
    if (!(MENUS as readonly string[]).includes(menu)) {
      throw invalid("contributes.menus", `unknown menu \`${menu}\``);
    }
    const missing = entries.find((e) => !commands.has(e));
    if (missing !== undefined) {
      throw invalid("contributes.menus", `\`${missing}\` is not a declared command`);
    }
  }
  const settings = new Set<string>();
  for (const setting of c.settings) {
    checkLocalId("contributes.settings", setting.id, settings);
    let valid = true;
    try {
      checkLocalized("contributes.settings.label", setting.label, 60);
    } catch {
      valid = false;
    }
    if (setting.type === "number") {
      valid &&=
        Number.isFinite(setting.min) &&
        Number.isFinite(setting.max) &&
        setting.min <= setting.default &&
        setting.default <= setting.max;
    }
    if (setting.type === "choice") valid &&= setting.choices.includes(setting.default);
    if (!valid) {
      throw invalid(
        "contributes.settings",
        `setting \`${setting.id}\`: label, range or default is invalid`,
      );
    }
  }
}

/**
 * Remarques qui ne refusent pas le manifeste mais qu'un développeur veut connaître (propres au
 * SDK, pas des règles de Bobine).
 */
export function manifestWarnings(m: Manifest): string[] {
  const warnings: string[] = [];
  if (m.api !== API_VERSION) {
    warnings.push(
      `api "${m.api}": this version of Bobine loads api "${API_VERSION}" only; the extension installs but does not load`,
    );
  }
  if (m.kind === "plugin" && m.contributes.panels.length > 0 && m.ui === null) {
    warnings.push("panels are declared but there is no `ui` page: Bobine shows no panel");
  }
  if (m.kind === "plugin" && m.ui !== null && m.contributes.panels.length === 0) {
    warnings.push("a `ui` page is set but no panel is declared in `contributes.panels`");
  }
  return warnings;
}
