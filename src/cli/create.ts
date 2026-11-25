import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isExtensionId, KINDS, type Kind } from "./manifest";

/** Racine du paquet du SDK (là où sont `package.json` et `templates/`). */
export function sdkRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "templates")) || !existsSync(join(dir, "package.json"))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error("templates not found next to the SDK");
    dir = parent;
  }
  return dir;
}

/**
 * Version du SDK à mettre dans le `package.json` du plugin : la version publiée, ou le dossier
 * local du SDK quand la CLI tourne depuis un clone (le paquet n'est pas encore sur npm).
 */
export function defaultSdkSpec(root = sdkRoot()): string {
  return root.split(sep).includes("node_modules")
    ? publishedRange(root)
    : `file:${root.replaceAll("\\", "/")}`;
}

/** Plage npm de cette version du SDK (`^0.1.0`), utilisée par les modèles de CI. */
export function publishedRange(root = sdkRoot()): string {
  const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    version: string;
  };
  return `^${version}`;
}

export type CreateOptions = { kind?: Kind; id?: string; sdk?: string };

function slugOf(dir: string): string {
  const slug = basename(resolve(dir))
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "my-extension";
}

function titleOf(slug: string): string {
  const words = slug.split("-").filter(Boolean).join(" ");
  // 40 caractères : la limite d'un titre de panneau dans le manifeste.
  return (words.charAt(0).toUpperCase() + words.slice(1)).slice(0, 40).trim();
}

/** Les modèles nomment `_gitignore` et `_github` (npm ne publie pas `.gitignore`). */
function targetName(name: string): string {
  return name === "_gitignore" ? ".gitignore" : name === "_github" ? ".github" : name;
}

/** Crée un projet d'extension prêt à vérifier et empaqueter. Renvoie les fichiers écrits. */
export function create(dir: string, options: CreateOptions = {}): string[] {
  const kind = options.kind ?? "plugin";
  if (!KINDS.includes(kind)) throw new Error(`unknown kind \`${kind}\`: plugin, theme or skill`);
  const target = resolve(dir);
  if (existsSync(target) && readdirSync(target).length > 0) {
    throw new Error(`${target} already exists and is not empty`);
  }
  const slug = slugOf(dir);
  const id = options.id ?? `me.${slug}`;
  if (!isExtensionId(id)) {
    throw new Error(
      `id \`${id}\`: expected \`author.name\` in lowercase letters, digits and dashes`,
    );
  }
  const values: Record<string, string> = {
    id,
    slug,
    name: titleOf(slug),
    sdk: options.sdk ?? defaultSdkSpec(),
    sdkRange: publishedRange(),
  };
  const written: string[] = [];
  const copy = (from: string, to: string, relative: string) => {
    for (const name of readdirSync(from).sort()) {
      const source = join(from, name);
      const out = join(to, targetName(name));
      const rel = relative ? `${relative}/${targetName(name)}` : targetName(name);
      if (statSync(source).isDirectory()) {
        copy(source, out, rel);
        continue;
      }
      const text = readFileSync(source, "utf8").replace(
        /\{\{(\w+)\}\}/g,
        (match, key: string) => values[key] ?? match,
      );
      mkdirSync(to, { recursive: true });
      writeFileSync(out, text);
      written.push(rel);
    }
  };
  const templates = join(sdkRoot(), "templates");
  copy(join(templates, kind), target, "");
  copy(join(templates, "common"), target, "");
  return written;
}
