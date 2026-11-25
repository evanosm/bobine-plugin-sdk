// Mêmes cas que les tests Rust de Bobine (`crates/extensions/src/manifest.rs`).
import { describe, expect, it } from "vitest";
import {
  isExtensionId,
  isSafePath,
  isSemverRange,
  ManifestError,
  manifestWarnings,
  parsePermission,
  readManifest,
  validateManifest,
} from "../src/cli/manifest";

function pluginJson(): Record<string, unknown> {
  return {
    id: "genez.scaline",
    kind: "plugin",
    name: { fr: "Scaline", en: "Scaline" },
    version: "1.2.0",
    api: "1",
    engines: { bobine: ">=0.4.0" },
    permissions: ["project:read", "project:write", "media:frames", "native:worker"],
    contributes: {
      commands: [{ id: "upscale", title: { fr: "Agrandir en 4K", en: "Upscale to 4K" } }],
      panels: [{ id: "scaline", title: { en: "Scaline" }, where: "library" }],
      menus: { clip: ["upscale"] },
      settings: [
        {
          type: "choice",
          id: "model",
          label: { en: "Model" },
          default: "fast",
          choices: ["fast", "quality"],
        },
      ],
    },
    main: "dist/main.js",
    native: { "darwin-arm64": "bin/worker" },
  };
}

const ALL = ["dist/main.js", "bin/worker"];

/** Le champ refusé, ou `null` si le manifeste passe. */
function refused(json: unknown, files: string[] = ALL): string | null {
  try {
    validateManifest(readManifest(json), new Set(files));
    return null;
  } catch (error) {
    if (error instanceof ManifestError) return error.field;
    throw error;
  }
}

describe("manifest", () => {
  it("accepts a complete plugin manifest", () => {
    expect(refused(pluginJson())).toBeNull();
    expect(manifestWarnings(readManifest(pluginJson()))).toEqual([
      "panels are declared but there is no `ui` page: Bobine shows no panel",
    ]);
  });

  it("refuses a manifest whose cited file is missing from the package", () => {
    expect(refused(pluginJson(), ["dist/main.js"])).toBe("files");
  });

  it("refuses paths that leave the package", () => {
    for (const path of [
      "../x.js",
      "/etc/passwd",
      "a/../../b",
      "C:/x.js",
      "a\\b.js",
      "./a.js",
      "",
    ]) {
      expect(isSafePath(path), path).toBe(false);
    }
    expect(isSafePath("dist/main.js")).toBe(true);
  });

  it("refuses an unknown permission and parses network domains", () => {
    expect(refused({ ...pluginJson(), permissions: ["files:all"] })).toBe("permissions");
    expect(parsePermission("network:api.example.com")).toEqual({
      type: "network",
      domain: "api.example.com",
    });
    expect(() => parsePermission("network:localhost")).toThrow(ManifestError);
    expect(() => parsePermission("network:http://x.com")).toThrow(ManifestError);
  });

  it("requires the native:worker permission for a native worker", () => {
    expect(refused({ ...pluginJson(), permissions: ["project:read"] })).toBe("native");
  });

  it("refuses an unknown native platform", () => {
    expect(
      refused({
        ...pluginJson(),
        native: { "beos-x86": "bin/worker" },
      }),
    ).toBe("native");
  });

  it("does not let a theme or a skill run code or ask permissions", () => {
    const theme = {
      id: "someone.night",
      kind: "theme",
      name: { en: "Night" },
      version: "1.0.0",
      api: "1",
      theme: "theme.json",
      permissions: ["project:read"],
    };
    expect(refused(theme, ["theme.json"])).toBe("kind");
    const skill = {
      id: "someone.podcast",
      kind: "skill",
      name: { en: "Podcast" },
      version: "1.0.0",
      api: "1",
      skill: "skill.md",
    };
    expect(refused(skill, ["skill.md"])).toBeNull();
    expect(refused({ ...skill, contributes: { commands: [] } }, ["skill.md"])).toBeNull();
  });

  it("requires the file of each kind", () => {
    const { main: _main, native: _native, ...noMain } = pluginJson();
    expect(refused({ ...noMain, permissions: [] })).toBe("main");
    expect(
      refused({ id: "a.b", kind: "theme", name: { en: "T" }, version: "1.0.0", api: "1" }, []),
    ).toBe("theme");
    expect(
      refused({ id: "a.b", kind: "skill", name: { en: "S" }, version: "1.0.0", api: "1" }, []),
    ).toBe("skill");
  });

  it("checks ids, names, menus and settings", () => {
    for (const id of ["Genez.Scaline", "scaline", "a.b.c", "-a.b", "a.b-"]) {
      expect(isExtensionId(id), id).toBe(false);
    }
    expect(refused({ ...pluginJson(), name: { fr: "Sans anglais" } })).toBe("name");

    const menus = pluginJson();
    (menus.contributes as Record<string, unknown>).menus = { clip: ["missing"] };
    expect(refused(menus)).toBe("contributes.menus");

    const unknownMenu = pluginJson();
    (unknownMenu.contributes as Record<string, unknown>).menus = { toolbar: ["upscale"] };
    expect(refused(unknownMenu)).toBe("contributes.menus");

    const settings = pluginJson();
    const contributes = settings.contributes as { settings: Record<string, unknown>[] };
    (contributes.settings[0] as Record<string, unknown>).default = "slow";
    expect(refused(settings)).toBe("contributes.settings");
  });

  it("refuses a number setting whose default is out of range", () => {
    const json = pluginJson();
    (json.contributes as Record<string, unknown>).settings = [
      { type: "number", id: "n", label: { en: "N" }, default: 20, min: 0, max: 10 },
    ];
    expect(refused(json)).toBe("contributes.settings");
  });

  it("refuses repeated local ids across commands and panels", () => {
    const json = pluginJson();
    (json.contributes as Record<string, unknown>).panels = [
      { id: "upscale", title: { en: "Panel" }, where: "library" },
    ];
    expect(refused(json)).toBe("contributes.panels");
  });

  it("refuses texts that are too long, in an unknown language or with control characters", () => {
    expect(refused({ ...pluginJson(), name: { en: "x".repeat(61) } })).toBe("name");
    expect(refused({ ...pluginJson(), name: { en: "Ok", "fr-FR": "Ok" } })).toBe("name");
    expect(refused({ ...pluginJson(), name: { en: "a\u0007b" } })).toBe("name");
  });

  it("checks version and engines.bobine as Rust semver does", () => {
    expect(refused({ ...pluginJson(), version: "1.2" })).toBe("version");
    expect(refused({ ...pluginJson(), version: "v1.2.0" })).toBe("version");
    expect(refused({ ...pluginJson(), engines: { bobine: ">=0.4 <1" } })).toBe("engines.bobine");
    for (const range of [">=0.4.0", ">=0.4.0, <1.0.0", "^0.3", "~1.2.3", "*", "0.3.x", "=1.0.0"]) {
      expect(isSemverRange(range), range).toBe(true);
    }
  });

  it("reports a structural error on the bobine.json field", () => {
    expect(refused({ ...pluginJson(), kind: "widget" })).toBe("bobine.json");
    expect(refused({ ...pluginJson(), permissions: "project:read" })).toBe("bobine.json");
    expect(refused([])).toBe("bobine.json");
  });

  it("warns that an extension for another api version installs but does not load", () => {
    const m = readManifest({ ...pluginJson(), api: "2" });
    expect(refused({ ...pluginJson(), api: "2" })).toBeNull();
    expect(manifestWarnings(m)[0]).toMatch(/api "2"/);
  });
});
