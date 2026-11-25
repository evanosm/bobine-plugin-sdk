// Mêmes cas que les tests Rust de Bobine (`theme.rs`, `skill.rs`).
import { describe, expect, it } from "vitest";
import { ManifestError } from "../src/cli/manifest";
import { checkSkill, checkTheme, MAX_SKILL_BYTES } from "../src/cli/package";

function theme(light: Record<string, string>): void {
  checkTheme(Buffer.from(JSON.stringify({ light })));
}

describe("theme file", () => {
  it("accepts colors, gray tint and radii", () => {
    expect(() =>
      theme({
        "--color-bg": "#fdfaf7",
        "--color-accent": "oklch(64.8% 0.238 21.6)",
        "--color-fg-muted": "rgba(20, 20, 20, 0.7)",
        "--color-surface": "var(--color-neutral-50)",
        "--gray-hue": "40",
        "--radius-md": "10px",
      }),
    ).not.toThrow();
  });

  it("refuses a value that could inject CSS", () => {
    for (const value of [
      "red; background: url(https://x)",
      "#fff}body{display:none",
      "oklch(1 0 0) !important",
      "url(x)",
      "expression(alert(1))",
      "var(--color-bg), url(x)",
    ]) {
      expect(() => theme({ "--color-bg": value }), value).toThrow(ManifestError);
    }
  });

  it("refuses tokens outside the closed list", () => {
    for (const token of [
      "--font-sans",
      "--spacing-panel",
      "--dur-fast",
      "color",
      "--color-",
      "--color-Bg",
    ]) {
      expect(() => theme({ [token]: "#fff" }), token).toThrow(ManifestError);
    }
    expect(() => theme({ "--radius-md": "200px" })).toThrow(ManifestError);
    expect(() => checkTheme(Buffer.from("{}"))).toThrow(ManifestError);
  });
});

describe("skill file", () => {
  it("is plain text with a size limit", () => {
    expect(() => checkSkill(Buffer.from("  Rythme TikTok : plans de 2 s.\n"))).not.toThrow();
    expect(() => checkSkill(Buffer.alloc(MAX_SKILL_BYTES + 1, "a"))).toThrow(ManifestError);
    expect(() => checkSkill(Buffer.from("\u0000bad"))).toThrow(ManifestError);
    expect(() => checkSkill(Buffer.from("   "))).toThrow(ManifestError);
    expect(() => checkSkill(Buffer.from([0xff, 0xfe]))).toThrow(ManifestError);
  });
});
