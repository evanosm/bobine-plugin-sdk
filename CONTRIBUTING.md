# Contribuer

Merci de ton aide. Le SDK suit Bobine : il ne doit jamais accepter ce que Bobine refuse, ni refuser ce qu'elle accepte.

## Installer et vérifier

Node 22.12 ou plus récent et pnpm (version dans `packageManager` du `package.json`).

```sh
pnpm install
pnpm lint        # Biome
pnpm typecheck   # TypeScript strict
pnpm test        # Vitest
pnpm build       # dist/ : ESM, IIFE, CLI, déclarations
```

La CI lance les mêmes commandes, plus `pnpm generate:check` et la construction de `examples/hello`.

## Règles

- Les règles de `src/cli/manifest.ts` et `src/cli/package.ts` recopient celles de Bobine
  (`crates/extensions/src/manifest.rs`, `package.rs`, `theme.rs`, `skill.rs`). Une règle qui change dans Bobine change
  ici, avec le test qui reprend le cas du test Rust.
- `src/commands.ts` est généré : ne le modifie pas à la main (voir « Mettre à jour les types des commandes » dans le
  README).
- Le client (`src/client.ts`) n'accepte une réponse que si elle vient de `window.parent`.
- Pas de `any`, pas de dépendance d'exécution sans bonne raison : le SDK et la CLI n'en ont aucune aujourd'hui.
- Tests nommés par comportement attendu.
- Commits au format conventionnel, en français (`feat(cli): …`, `fix(client): …`).

## Signaler un problème

Ouvre une issue avec la version du SDK, celle de Bobine, et le `bobine.json` concerné si c'est un refus de `check`.
