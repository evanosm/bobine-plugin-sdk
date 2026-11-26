# {{name}}

A plugin for [Bobine](https://genez.app/bobine), made with `@bobine/plugin-sdk`.

```sh
pnpm install
pnpm build             # bundles src/ into dist/
pnpm check             # bobine.json and files, with Bobine's rules
pnpm dev               # how to load this folder in Bobine; rebuilds on change
pnpm run package       # writes {{id}}-0.1.0.bobine-ext
pnpm exec bobine-plugin login     # once: your Bobine account, code by email
pnpm exec bobine-plugin publish   # public and final for this version
```

- `bobine.json`: the manifest (id, permissions, commands, panels, settings).
- `src/main.ts`: the logic, in a hidden sandboxed iframe.
- `src/panel.html`, `src/panel.ts`: the panel shown in Bobine's library.
- `.github/workflows/bobine.yml`: checks and packages on every push (publish from your machine).
