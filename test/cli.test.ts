import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { create } from "../src/cli/create";
import { triggersBuild } from "../src/cli/dev";
import { ManifestError } from "../src/cli/manifest";
import { pack } from "../src/cli/pack";
import { checkDir } from "../src/cli/package";

const temp = realpathSync(mkdtempSync(join(tmpdir(), "bobine-sdk-")));
afterAll(() => {
  rmSync(temp, { recursive: true, force: true });
});

/** Lit une archive zip (répertoire central) : chemin → contenu. */
function readZip(zip: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extra = zip.readUInt16LE(at + 30);
    const comment = zip.readUInt16LE(at + 32);
    const offset = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    const localName = zip.readUInt16LE(offset + 26);
    const localExtra = zip.readUInt16LE(offset + 28);
    const body = zip.subarray(
      offset + 30 + localName + localExtra,
      offset + 30 + localName + localExtra + size,
    );
    out.set(name, method === 8 ? inflateRawSync(body) : Buffer.from(body));
    at += 46 + nameLength + extra + comment;
  }
  return out;
}

function write(dir: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, text);
  }
}

const skillManifest = JSON.stringify({
  id: "someone.podcast",
  kind: "skill",
  name: { en: "Podcast" },
  version: "1.0.0",
  api: "1",
  skill: "skill.md",
});

describe("pack", () => {
  it("writes a zip with bobine.json at the root, without hidden files, node_modules or archives", () => {
    const dir = join(temp, "skill");
    write(dir, {
      "bobine.json": skillManifest,
      "skill.md": "Short shots.",
      "docs/notes.md": "notes",
      ".DS_Store": "x",
      ".git/config": "x",
      "node_modules/dep/index.js": "x",
      "old.bobine-ext": "x",
    });
    const out = join(temp, "podcast.bobine-ext");
    const result = pack(dir, out);
    expect(result.archive).toBe(out);
    const files = readZip(readFileSync(out));
    expect([...files.keys()].sort()).toEqual(["bobine.json", "docs/notes.md", "skill.md"]);
    expect(files.get("skill.md")?.toString()).toBe("Short shots.");
    expect(files.get("bobine.json")?.toString()).toBe(skillManifest);
  });

  it("names the archive after the id and version by default", () => {
    const dir = join(temp, "skill");
    const cwd = process.cwd();
    process.chdir(temp);
    try {
      expect(pack(dir).archive).toBe(join(temp, "someone.podcast-1.0.0.bobine-ext"));
    } finally {
      process.chdir(cwd);
    }
  });

  it("refuses to pack an invalid folder and writes nothing", () => {
    const dir = join(temp, "broken");
    write(dir, { "bobine.json": skillManifest });
    const out = join(temp, "broken.bobine-ext");
    expect(() => pack(dir, out)).toThrow(ManifestError);
    expect(existsSync(out)).toBe(false);
  });
});

describe("create", () => {
  it("makes a theme and a skill that pass the check as they are", () => {
    for (const kind of ["theme", "skill"] as const) {
      const dir = join(temp, `new-${kind}`);
      const files = create(dir, { kind, sdk: "^0.1.0" });
      expect(files).toContain(".github/workflows/bobine.yml");
      expect(files).toContain(".gitignore");
      const { manifest } = checkDir(dir);
      expect(manifest.id).toBe(`me.new-${kind}`);
      expect(manifest.kind).toBe(kind);
      expect(readFileSync(join(dir, ".github/workflows/bobine.yml"), "utf8")).not.toContain("{{");
    }
  });

  it("makes a plugin that passes the check once built", () => {
    const dir = join(temp, "my-plugin");
    create(dir, { id: "someone.my-plugin", sdk: "^0.1.0" });
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    expect(pkg.devDependencies["bobine-plugin-sdk"]).toBe("^0.1.0");
    expect(() => checkDir(dir)).toThrow(/dist\/main.js/);
    write(dir, { "dist/main.js": "", "dist/panel.html": "" });
    expect(checkDir(dir).manifest.id).toBe("someone.my-plugin");
  });

  it("refuses a folder that is not empty and an invalid id", () => {
    expect(() => create(join(temp, "my-plugin"))).toThrow(/not empty/);
    expect(() => create(join(temp, "other"), { id: "Bad" })).toThrow(/author.name/);
  });
});

describe("dev", () => {
  it("rebuilds on source changes, not on its own outputs", () => {
    expect(triggersBuild("src/main.ts", ["dist"])).toBe(true);
    expect(triggersBuild("bobine.json", ["dist"])).toBe(true);
    expect(triggersBuild("dist/main.js", ["dist"])).toBe(false);
    expect(triggersBuild("build/main.js", ["build"])).toBe(false);
    expect(triggersBuild("node_modules/x/index.js", [])).toBe(false);
    expect(triggersBuild(".git/index", [])).toBe(false);
    expect(triggersBuild("me.x-1.0.0.bobine-ext", [])).toBe(false);
  });
});
