// Génère src/commands.ts depuis schema/commands.json (copie du schéma de la Command API de Bobine).
// Générateur volontairement court : il couvre ce que le schéma de Bobine utilise ($ref, $defs,
// oneOf, anyOf, enum, const, objets, tableaux, types nullables). Un mot-clé inconnu fait échouer
// le script plutôt que de produire un type faux.
//
// Usage : node scripts/generate-types.mjs [--check]
//   --check : échoue si src/commands.ts n'est pas à jour (utilisé par la CI).

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = join(root, "schema/commands.json");
const outPath = join(root, "src/commands.ts");

const KNOWN = new Set([
  "$schema",
  "$defs",
  "$ref",
  "title",
  "description",
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "oneOf",
  "anyOf",
  "enum",
  "const",
  "format",
  "minimum",
  "maximum",
  "default",
]);

const schema = JSON.parse(readFileSync(schemaPath, "utf8"));

function refName(ref) {
  const prefix = "#/$defs/";
  if (!ref.startsWith(prefix)) throw new Error(`unsupported $ref ${ref}`);
  return ref.slice(prefix.length);
}

function comment(text, indent) {
  if (!text) return "";
  const lines = text.replaceAll("*/", "*\\/").split("\n");
  return `${indent}/**\n${lines.map((l) => `${indent} * ${l}`.trimEnd()).join("\n")}\n${indent} */\n`;
}

function key(name) {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}

function wrap(ts) {
  return /[|&]/.test(ts) && !/^\{[\s\S]*\}$/.test(ts) ? `(${ts})` : ts;
}

function union(parts) {
  const unique = [...new Set(parts)];
  return unique.length === 0 ? "never" : unique.join(" | ");
}

function objectType(s, indent) {
  const props = s.properties ?? {};
  const required = new Set(s.required ?? []);
  const inner = `${indent}  `;
  const lines = Object.entries(props).map(([name, prop]) => {
    const optional = required.has(name) ? "" : "?";
    return `${comment(prop.description, inner)}${inner}${key(name)}${optional}: ${toTs(prop, inner)};`;
  });
  if (s.additionalProperties && typeof s.additionalProperties === "object") {
    lines.push(`${inner}[key: string]: ${toTs(s.additionalProperties, inner)};`);
  }
  if (lines.length === 0) return "Record<string, unknown>";
  return `{\n${lines.join("\n")}\n${indent}}`;
}

function singleType(type, s, indent) {
  switch (type) {
    case "string":
      return "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array":
      return s.items ? `${wrap(toTs(s.items, indent))}[]` : "unknown[]";
    case "object":
      return objectType(s, indent);
    default:
      throw new Error(`unsupported type ${type}`);
  }
}

function toTs(s, indent = "") {
  for (const k of Object.keys(s)) if (!KNOWN.has(k)) throw new Error(`unsupported keyword ${k}`);
  const parts = [];
  if (s.$ref) parts.push(refName(s.$ref));
  if ("const" in s) parts.push(JSON.stringify(s.const));
  else if (s.enum) parts.push(union(s.enum.map((v) => JSON.stringify(v))));
  else if (s.type && !s.$ref) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    parts.push(union(types.map((t) => singleType(t, s, indent))));
  } else if (s.$ref && s.properties) {
    // `$ref` + propriétés (variantes de `Command`) : le discriminant `type` s'ajoute au type cité.
    parts.unshift(objectType({ ...s, $ref: undefined }, indent));
  }
  const alternatives = s.oneOf ?? s.anyOf;
  if (alternatives) parts.push(wrap(union(alternatives.map((a) => toTs(a, indent)))));
  if (parts.length === 0) return "unknown";
  return parts.length === 1 ? parts[0] : parts.map(wrap).join(" & ");
}

let out = `// FICHIER GÉNÉRÉ par scripts/generate-types.mjs depuis schema/commands.json : ne pas modifier.
// Pour le mettre à jour : copier le schéma d'une nouvelle version de Bobine puis \`pnpm generate\`.

`;
out += comment(schema.description, "");
out += `export type Transaction = ${toTs({ ...schema, $schema: undefined, $defs: undefined, title: undefined, description: undefined })};\n\n`;
for (const [name, def] of Object.entries(schema.$defs)) {
  out += `${comment(def.description, "")}export type ${name} = ${toTs({ ...def, description: undefined })};\n\n`;
}

const check = process.argv.includes("--check");
const previous = (() => {
  try {
    return readFileSync(outPath, "utf8");
  } catch {
    return "";
  }
})();
writeFileSync(outPath, out);
execFileSync(join(root, "node_modules/.bin/biome"), ["format", "--write", outPath], {
  stdio: "ignore",
});
if (check) {
  const fresh = readFileSync(outPath, "utf8");
  if (fresh !== previous) {
    writeFileSync(outPath, previous);
    console.error("src/commands.ts is out of date: run `pnpm generate`.");
    process.exit(1);
  }
}
