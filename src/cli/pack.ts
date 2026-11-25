import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateManifest } from "./manifest";
import { type CheckResult, checkDir } from "./package";
import { createZip } from "./zip";

export const ARCHIVE_EXTENSION = ".bobine-ext";

export type PackResult = CheckResult & { archive: string; bytes: number; count: number };

/**
 * Vérifie le dossier puis l'empaquette en `.bobine-ext` (zip, `bobine.json` à la racine).
 * Fichiers cachés, `node_modules` et archives `.bobine-ext` déjà présentes n'y entrent pas.
 */
export function pack(dir: string, out?: string): PackResult {
  const result = checkDir(dir);
  const files = result.files.filter((f) => !f.path.endsWith(ARCHIVE_EXTENSION));
  validateManifest(result.manifest, new Set(files.map((f) => f.path)));
  const { id, version } = result.manifest;
  const archive = resolve(out ?? `${id}-${version}${ARCHIVE_EXTENSION}`);
  const zip = createZip(files.map((f) => ({ path: f.path, data: readFileSync(f.full) })));
  writeFileSync(archive, zip);
  return { ...result, archive, bytes: zip.length, count: files.length };
}
