import type { Theme } from "./client";

/** Ce dont `applyTheme` a besoin d'un élément (par défaut `document.documentElement`). */
export type ThemeTarget = {
  style: { setProperty(name: string, value: string): void; colorScheme: string };
};

/**
 * Pose les tokens du thème de Bobine en variables CSS sur le panneau (`--color-bg`,
 * `--color-fg`, `--color-accent-solid`, `--radius-md`…) et règle `color-scheme`. Le panneau garde
 * ainsi l'allure de l'app, en clair comme en sombre. Seules les variables `--color-*` et
 * `--radius-*` sont posées.
 */
export function applyTheme(theme: Theme, target: ThemeTarget = document.documentElement): void {
  for (const [name, value] of Object.entries(theme.tokens)) {
    if (!/^--(color|radius)-[a-z0-9-]+$/.test(name) || !value) continue;
    target.style.setProperty(name, value);
  }
  target.style.colorScheme = theme.mode === "dark" ? "dark" : "light";
}
