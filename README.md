# @bobine/plugin-sdk

Le kit pour écrire des extensions de [Bobine](https://genez.app/bobine), l'éditeur vidéo de Genez : un client
TypeScript typé pour parler à Bobine depuis un plugin, et une CLI `bobine-plugin` qui crée, vérifie et empaquette ton
extension.

> **État** : version 0.1, pas encore publiée sur npm. Elle suit l'API de plugin « 1 » de Bobine.
> `bobine-plugin publish` publie sur la marketplace de Bobine (extensions gratuites).

## Ce qu'est une extension Bobine

Un dossier avec un manifeste `bobine.json` à la racine. Il existe trois sortes d'extensions :

| Sorte      | Contenu                                                                                         | Exécute du code |
| ---------- | ----------------------------------------------------------------------------------------------- | --------------- |
| **Plugin** | Du code TypeScript (compilé en JavaScript), un panneau facultatif, des commandes, des réglages. | Oui, isolé      |
| **Thème**  | Des valeurs pour les couleurs et les rayons de l'interface, en clair et en sombre.              | Non             |
| **Skill**  | Des consignes en Markdown pour Bob, l'assistant de Bobine (façon de monter, rythme, titres).    | Non             |

Un plugin ajoute des commandes (palette Ctrl+K, menu Plugins, clic droit sur la timeline ou sur un clip), un panneau dans
la bibliothèque et des réglages. Bobine dessine elle-même le panneau des réglages à partir du manifeste : ton plugin n'a
pas à le faire.

Tout ce qu'un plugin change dans le projet passe par la Command API de Bobine, la même que l'interface et Bob. Chaque
changement devient une étape de l'historique, au nom du plugin (« Bonjour : 12 repères »), qui s'annule comme les autres.

## Philosophie

Bobine demande la même chose à tous les plugins, ceux de Genez compris :

- **Simple pour 80 % des cas.** Un bouton et un réglage visibles ; le reste plus loin. Un réglage a toujours une valeur
  par défaut (`check` le vérifie).
- **Transparent.** Ce qui va changer se montre avant : `bobine.project.propose()` affiche les changements sur la timeline
  et l'utilisateur choisit d'appliquer ou d'annuler. Les permissions s'affichent en clair à l'installation.
- **Personnalisable.** Les réglages déclarés dans le manifeste donnent un panneau généré dans « Mes extensions ».

## Démarrer en 5 commandes

Tant que le paquet n'est pas sur npm, on part d'un clone de ce dépôt (Node 22.12 ou plus récent, pnpm) :

```sh
git clone https://github.com/evanosm/bobine-plugin-sdk.git
cd bobine-plugin-sdk && pnpm install && pnpm build && cd ..
node bobine-plugin-sdk/dist/cli.js create mon-plugin --id moi.mon-plugin
cd mon-plugin && pnpm install && pnpm build
pnpm dev
```

`create` écrit un plugin prêt à l'emploi : `bobine.json`, `src/main.ts` (la logique), `src/panel.html` et
`src/panel.ts` (le panneau), un `build.mjs` (esbuild) et un modèle de CI GitHub Actions. Depuis un clone, la dépendance
`@bobine/plugin-sdk` du plugin pointe vers ce dossier local (`file:`), et la CLI le signale.

`pnpm dev` explique comment charger le dossier dans Bobine, puis reconstruit à chaque changement :

1. Dans Bobine, menu **Plugins > Charger une extension en développement…**
2. Choisis le dossier `mon-plugin`.

Bobine lit alors les fichiers directement dans ce dossier, en mode développeur. Après une reconstruction, rouvre le
panneau, ou désactive puis réactive le plugin dans « Mes extensions ». Après un changement de `bobine.json`, charge le
dossier à nouveau.

Pour un thème ou un skill : `create mon-theme --kind theme` ou `create mon-skill --kind skill`. Rien à construire :
`check` puis `pack` suffisent.

## Le manifeste `bobine.json`

```json
{
  "id": "moi.bonjour",
  "kind": "plugin",
  "name": { "en": "Hello", "fr": "Bonjour" },
  "version": "1.0.0",
  "api": "1",
  "permissions": ["project:read", "project:write"],
  "contributes": {
    "commands": [{ "id": "hello", "title": { "en": "Say hello", "fr": "Dire bonjour" } }],
    "menus": { "plugins": ["hello"], "timeline": ["hello"] },
    "panels": [
      { "id": "summary", "title": { "en": "Hello", "fr": "Bonjour" }, "where": "library" }
    ],
    "settings": [
      {
        "type": "number",
        "id": "every",
        "label": { "en": "Seconds" },
        "default": 10,
        "min": 1,
        "max": 600
      }
    ]
  },
  "main": "dist/main.js",
  "ui": "dist/panel.html"
}
```

Les règles, les mêmes que dans Bobine (`bobine-plugin check` les applique toutes) :

- `id` : `auteur.nom`, en minuscules, chiffres et tirets, 64 caractères au plus.
- `version` : semver (`1.2.0`). `engines.bobine` (facultatif) : une plage au format du crate Rust `semver`, avec des
  virgules (`>=0.4.0, <1.0.0`).
- `api` : `"1"`. Une extension qui vise une autre version s'installe mais ne se charge pas (`check` le signale).
- Textes (`name`, `description`, titres, libellés) : un objet par langue de deux lettres ; `en` est obligatoire, c'est
  le repli. 60 caractères pour un nom ou un titre de commande, 40 pour un titre de panneau, 400 pour une description.
- Chaque fichier cité (`main`, `ui`, `theme`, `skill`, `icon`) existe dans le paquet, sous un chemin relatif sans `..`,
  sans `\` ni `:`.
- Plugin : `main` est obligatoire. Thème : `theme`. Skill : `skill`. Un thème ou un skill ne déclare ni code, ni
  permission, ni contribution.
- `contributes.menus` : `plugins`, `timeline` ou `clip`, et seulement des commandes déclarées.
- `contributes.settings` : `toggle`, `number` (`min` ≤ `default` ≤ `max`), `choice` (`default` dans `choices`), `text`.
- `contributes.panels[].where` : `library` ou `inspector` (pour l'instant, Bobine affiche aussi un panneau `inspector`
  dans la bibliothèque).

## Permissions

La liste est fermée : une permission inconnue refuse le manifeste.

| Permission          | Ce qu'elle ouvre dans le protocole 1                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `project:read`      | `project.get`, `selection.get`, l'événement `project`                                                 |
| `project:write`     | `project.dispatch`, `project.propose`, `project.null.create`, et `media.encode.*` avec `media:frames` |
| `media:frames`      | `media.frames`, et `media.encode.*` avec `project:write` (Bobine 0.4.0 ou plus récente)               |
| `network:<domaine>` | Acceptée par le manifeste, aucune méthode pour l'instant (le bac à sable coupe le réseau)             |
| `native:worker`     | `native.call` : programme natif hors processus, réservé aux plugins de Genez dans la v1               |

Bobine vérifie les permissions à chaque appel, contre celles accordées à l'installation. S'il en manque une, l'appel
échoue avec le code `permission_denied`.

## Le bac à sable

La logique d'un plugin tourne dans une iframe cachée, et chaque panneau dans une iframe visible. Les deux ont la même
isolation : `sandbox="allow-scripts"` sans `allow-same-origin` (origine opaque), et une politique de sécurité (CSP) qui
n'autorise que les fichiers du plugin lui-même.

Un plugin ne peut pas :

- ouvrir une connexion réseau (`fetch`, WebSocket, image distante) ;
- toucher à la fenêtre de Bobine, à son DOM ou à Tauri ;
- lire les fichiers d'un autre plugin, ni ceux de l'ordinateur ;
- utiliser `localStorage`, les cookies ou IndexedDB ;
- exécuter un script en ligne (`<script>…</script>` dans le HTML) : les scripts sont des fichiers à part ;
- importer un média ou une police : `ImportMedia`, `SetMediaInfo` et `ImportFonts` lui sont refusées, comme à Bob.

Plafonds : 40 appels par seconde (au-delà, `rate_limited`), 500 commandes par transaction, 200 caractères pour un
libellé ou une notification.

La logique d'un plugin partage le fil de l'interface de Bobine : un calcul long fige l'app. Garde les calculs
courts.

## Référence de l'API

```ts
import { applyTheme, bobine, flicks } from "@bobine/plugin-sdk";
```

| Appel                                                              | Permission                       | Renvoie                                                                 |
| ------------------------------------------------------------------ | -------------------------------- | ----------------------------------------------------------------------- |
| `bobine.project.get()`                                             | `project:read`                   | Le projet ouvert (`Project`) ou `null`                                  |
| `bobine.selection.get()`                                           | `project:read`                   | `{ clips: string[], playhead: number }` (tête de lecture en secondes)   |
| `bobine.project.dispatch({ label, commands })`                     | `project:write`                  | `{ applied }` : appliqué en une étape annulable                         |
| `bobine.project.propose({ label, commands })`                      | `project:write`                  | `{ applied }` quand l'utilisateur a choisi                              |
| `bobine.ui.notify(kind, text)`                                     | aucune                           | Notification `"info"`, `"ok"` ou `"error"`, préfixée du nom du plugin   |
| `bobine.settings.get()`                                            | aucune                           | Les valeurs des réglages (défaut du manifeste sinon)                    |
| `bobine.theme.get()`                                               | aucune                           | `{ mode: "light" \| "dark", tokens }`                                   |
| `bobine.native.call(method, params?, { timeout? })`                | `native:worker`                  | Le résultat de la méthode du programme natif                            |
| `bobine.media.frames(request)`                                     | `media:frames`                   | `{ raw, header, count, width, height }` (chemins pour le programme)     |
| `bobine.project.createNull({ label, at, keys?, children? })`       | `project:write`                  | `{ applied, null }` : un objet nul proposé (Bobine 0.5 ou plus récente) |
| `bobine.media.encode.begin({ width, height, fps, name, frames? })` | `media:frames` + `project:write` | `{ session }`                                                           |
| `bobine.media.encode.append({ session, raw })`                     | `media:frames` + `project:write` | `{ frames }` : images encodées depuis le début                          |
| `bobine.media.encode.finish({ session })`                          | `media:frames` + `project:write` | `{ media }` : le rendu importé dans le projet                           |
| `bobine.media.encode.cancel({ session })`                          | `media:frames` + `project:write` | Rien : le fichier partiel est supprimé                                  |
| `bobine.on(name, handler)`                                         |                                  | Abonnement ; renvoie une fonction de désabonnement                      |
| `bobine.command(id, handler)`                                      |                                  | Lance `handler` quand la commande `id` est choisie                      |
| `bobine.call(method, params)`                                      |                                  | Appel brut d'une méthode du protocole                                   |

`applied` vaut `false` quand Bobine refuse les commandes (l'utilisateur voit pourquoi) ou quand il annule une
proposition.

Événements de `bobine.on` :

| Nom        | Données            | Quand                                                                                                                  |
| ---------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `command`  | `{ id }`           | Une commande du plugin est choisie (palette, menu, clic droit)                                                         |
| `project`  | `null`             | Le projet a changé, au plus une fois toutes les 200 ms (avec `project:read`) ; demande le contenu avec `project.get()` |
| `settings` | les valeurs        | Un réglage a changé dans « Mes extensions »                                                                            |
| `theme`    | `{ mode, tokens }` | Le thème a changé, et à l'ouverture d'un panneau                                                                       |

Erreurs : un appel refusé rejette sa promesse avec une `BobineError`, dont `code` vaut `unknown_method`,
`permission_denied`, `invalid_params`, `forbidden_command`, `rate_limited` ou `failed`, plus les codes du programme
natif et des images ci-dessous (le type `ErrorCode` les liste tous). Avec `bobine.command`, une erreur du handler
s'affiche dans Bobine en notification d'erreur.

### Programme natif, images et rendus

Réservé aux plugins de Genez dans la v1 (un programme natif n'est publié que par un compte admin de la marketplace),
avec Bobine 0.4.0 ou plus récente. Le programme natif (`native` du manifeste) tourne hors de l'iframe, avec un dossier
de travail à lui ; il ne lit aucun fichier du projet et n'embarque pas FFmpeg : Bobine décode et encode pour lui.

- `native.call(method, params, { timeout })` envoie `{ method, params }` au programme et renvoie son `result`.
  `timeout` en secondes : 60 par défaut, 600 au plus (au-delà, le programme est tué). Paramètres : 1 Mo de JSON au
  plus. Un appel à la fois par plugin. Une erreur du programme arrive avec son propre `code`.
- `media.frames(request)` décode un média (`media`, temps du média) OU un clip (`clip`, secondes depuis son début),
  `from` et `to` en secondes (tout par défaut, `to` exclu), dans une boîte `width` × `height` (proportions gardées,
  jamais agrandie, 1920 au plus), `format` `"gray"` (1 octet par pixel) ou `"rgba"` (4). `fps` : 8 par défaut, 30 au
  plus. `every_frame: true` (avec `media` seulement, sans `fps`) rend CHAQUE image décodée dont l'instant est dans
  `[from, to)` : des lots consécutifs (`to` de l'un = `from` du suivant) ne se recouvrent pas. Un lot dépasse au plus
  512 Mo et 20 000 images. Réponse : `raw` (images bout à bout, ligne par ligne) et `header` (JSON : `count`,
  `width`, `height`, `format`, `fps`, `every_frame`, `bytes_per_frame`, `timestamps` en secondes), chemins relatifs
  au dossier de travail, à passer au programme. Bobine garde les deux derniers lots.
- `media.encode.*` : le programme écrit des images RGBA bout à bout dans son dossier de travail ; Bobine les encode en
  ProRes 422 (`.mov` sans son, rangé dans `<Vidéos>/Bobine/Rendus/`) puis importe le fichier, car un plugin ne peut
  pas envoyer `ImportMedia`. `begin` : côtés pairs, 8192 au plus, aire ≤ 8192 × 4320, `fps` `{ num, den }` ≤ 240, un
  nom non vide, et `frames` facultatif (images prévues : Bobine 0.5 refuse d'emblée en `disk_full` un rendu sans
  place, une version plus ancienne l'ignore). `append` : `raw` relatif au dossier de travail, taille multiple de `width × height × 4`, supprimé
  ensuite (même en cas d'erreur). `finish` : une étape d'historique « <plugin> : importer le rendu « <nom> » », renvoie
  l'id du média. Une session à la fois par plugin ; désactiver ou désinstaller le plugin l'annule.
- La commande `ReplaceClipMedia { clip, media, source_in }` fait lire au clip le média rendu (propriétés, keyframes,
  lien et transitions gardés) : à proposer avec `project.propose`.

### Objets nuls (Bobine 0.5)

`bobine.project.createNull({ label, at, duration?, keys?, children?, parentAt? })` propose, en une seule étape, un
objet nul (clip invisible, jamais rendu) posé à `at` sur une piste vidéo libre (créée si besoin), animé par `keys`
(`CopiedKeyframe`, temps relatifs à son début, comme `PasteKeyframes`), et les clips `children` liés à lui : ils
gardent leur image à `parentAt` (leur début par défaut) puis suivent son mouvement. Temps en flicks. Réponse :
`{ applied, null }`, `null` étant l'id du clip nul. Une version plus ancienne de Bobine répond `unknown_method` : un
plugin qui vise aussi la 0.4 le détecte à l'exécution. Les commandes `AddNull`, `SetParent` et `ClearParent` sont aussi
permises dans `project.dispatch` et `project.propose`.

| Code              | Quand                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `not_allowed`     | Plugin désactivé ou incompatible, permission retirée, signature invalide                    |
| `no_worker`       | Pas de programme natif pour cette plateforme                                                |
| `spawn_failed`    | Le programme n'a pas pu être lancé                                                          |
| `busy`            | Un appel natif, ou un rendu, est déjà en cours pour ce plugin                               |
| `timeout`         | Délai dépassé : le programme est tué                                                        |
| `worker_crashed`  | Le programme s'est arrêté pendant l'appel (relancé au suivant)                              |
| `stopped`         | Le plugin a été arrêté pendant l'appel (désactivé, désinstallé, app fermée)                 |
| `worker_error`    | Le programme a renvoyé un code illisible                                                    |
| `not_ready`       | `media.frames` : le média est encore en cours d'analyse                                     |
| `no_video`        | `media.frames` : le média n'a pas d'image                                                   |
| `decode_failed`   | `media.frames` : le média n'a pas pu être décodé                                            |
| `no_frames`       | Aucune image dans l'intervalle, ou `finish` sans image (le rendu est supprimé)              |
| `too_many_frames` | Lot de plus de 512 Mo ou 20 000 images : demander moins                                     |
| `write_failed`    | Écriture impossible (dossier de travail ou des rendus)                                      |
| `unknown_session` | Session de rendu inconnue ou fermée                                                         |
| `encode_failed`   | L'encodeur a échoué                                                                         |
| `import_failed`   | Le rendu n'a pas pu être importé (il est supprimé)                                          |
| `disk_full`       | Disque plein (Bobine 0.5) : rendu refusé d'emblée si `begin` a reçu `frames`, ou interrompu |
| `no_sequence`     | `project.null.create` : aucune séquence ouverte                                             |

Autres exports :

- `applyTheme(theme)` pose les tokens reçus (`--color-bg`, `--color-fg`, `--color-accent-solid`, `--radius-md`…) en
  variables CSS du panneau et règle `color-scheme`. Écris ton CSS avec `var(--color-fg)` et le panneau suit le thème.
- `FLICKS_PER_SECOND` (705 600 000) et `flicks(secondes)` : la Command API compte le temps en flicks, des entiers.
- `activeSequence(project)` : la séquence active, ou `null`.
- Les types de toutes les commandes (`Command`, `AddMarker`, `SetClipProp`…), générés depuis le schéma de Bobine, et
  `PluginCommand` (les commandes permises à un plugin). `Project`, `Sequence` et `Track` sont des types partiels : le
  projet contient d'autres champs.
- `createBobine(getWindow)` : un client à part, pour les tests.

Exemple complet : [`examples/hello`](examples/hello), qui dit bonjour et propose un repère toutes les N secondes
(réglage) sur la séquence active.

### Sans bundler

`dist/bobine-plugin-sdk.iife.js` (export `@bobine/plugin-sdk/iife`) expose tout sur la variable globale `BobineSDK`.
Dans un panneau, ajoute `<script src="bobine-plugin-sdk.iife.js"></script>` avant ton script, puis
`const { bobine, applyTheme } = BobineSDK;`. Pour la logique (`main`), Bobine charge un seul fichier, sans module ES :
colle le contenu du fichier IIFE en tête de ton script, ou passe par un bundler comme le modèle.

## La CLI

```sh
bobine-plugin create <dossier> [--kind plugin|theme|skill] [--id auteur.nom] [--sdk <version>]
bobine-plugin check [dossier]
bobine-plugin pack [dossier] [--out <fichier>]
bobine-plugin dev [dossier]
bobine-plugin login
bobine-plugin logout
bobine-plugin publish [dossier] [--yes] [--out <fichier>]
```

- `create` : un projet prêt à vérifier, avec `.github/workflows/bobine.yml` (vérification et archive à chaque push).
  Ce modèle de CI installe le SDK depuis npm : il fonctionnera une fois le paquet publié.
- `check` : les règles de Bobine sur `bobine.json`, les fichiers cités, les tailles (128 Mo par fichier, 256 Mo et
  2 000 fichiers en tout), le contenu d'un thème (liste fermée de tokens, valeurs sans injection CSS) ou d'un skill
  (UTF-8, 16 Ko au plus). Messages en anglais, comme ceux de Bobine.
- `pack` : vérifie, puis écrit `<id>-<version>.bobine-ext` (une archive zip, `bobine.json` à la racine). Tout le dossier
  y entre, sauf les fichiers cachés, `node_modules` et les archives `.bobine-ext`.
- `dev` : construit (si le `package.json` a un script `build`), vérifie, explique comment charger le dossier dans
  Bobine, puis reconstruit à chaque changement.
- `login`, `logout`, `publish` : voir la section suivante.

## Publier

La marketplace de Bobine accepte les extensions gratuites. Il te faut un compte Bobine (celui de l'app).

```sh
bobine-plugin login       # ton e-mail, puis le code à 6 chiffres reçu par e-mail
bobine-plugin publish     # dans le dossier de l'extension
```

- `login` ne crée pas de compte : avec un e-mail inconnu, la CLI te demande d'en créer un dans Bobine d'abord. La session
  est gardée dans `~/.config/bobine-plugin/session.json` (ou `$XDG_CONFIG_HOME/bobine-plugin/`), lisible par toi seul,
  et se rafraîchit toute seule quand elle expire. `logout` la révoque et efface le fichier.
- `publish` lance `check` et `pack`, puis rappelle que la version sera publique et définitive, et demande de confirmer
  (`--yes` pour ne pas demander). Le serveur re-signe l'archive avec la clé de la marketplace : c'est cette signature qui
  permet d'installer un plugin hors du mode développeur.
- Une version publiée ne change jamais. Pour corriger, monte `version` dans `bobine.json` et publie à nouveau.
- Le premier compte qui publie un id en devient propriétaire : personne d'autre ne peut publier sous cet id.

Les refus du serveur et ce que la CLI te dit de faire :

| Réponse                  | Cause                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------ |
| `401`                    | Session expirée ou révoquée : `bobine-plugin login`                                  |
| `403 account_suspended`  | Compte suspendu                                                                      |
| `403 reserved_namespace` | Les ids `genez.*` et `bobine.*` sont réservés à Genez                                |
| `403 native_not_allowed` | Les programmes natifs (`native`, `native:worker`) sont réservés aux plugins de Genez |
| `403 not_owner`          | L'id appartient à un autre compte                                                    |
| `409 version_exists`     | Cette version est déjà publiée                                                       |
| `413`                    | Archive de plus de 50 Mo (la CLI le vérifie avant l'envoi)                           |
| `429`                    | 20 publications par compte sur 24 heures au plus                                     |
| `400 invalid_manifest`   | Le serveur refuse le paquet, avec le détail                                          |

Une fois publiée, l'extension apparaît dans Bobine (**Plugins > Parcourir les extensions…**) et dans le catalogue public
de l'API (`https://genez.app/api/v1/extensions/<id>`).

Publie depuis ta machine, pas depuis la CI : la session Supabase change de jeton de rafraîchissement à chaque usage, un
secret de CI deviendrait vite invalide. Le modèle de CI de `create` vérifie et empaquette seulement.

Les variables `BOBINE_SUPABASE_URL`, `BOBINE_SUPABASE_ANON_KEY` et `BOBINE_API_URL` remplacent les adresses par défaut
(serveur de test, par exemple).

Sans marketplace, un thème ou un skill se partage aussi en archive (Bobine l'installe en le marquant « non vérifié »).
Un plugin non signé ne se charge qu'en mode développeur.

## Le protocole brut

Le SDK n'a rien de magique : un plugin peut parler à Bobine avec `postMessage`.

Appel, envoyé à `window.parent` avec la cible `"*"` (l'origine du plugin est opaque, seule `"*"` atteint Bobine) :

```js
{ bobine: 1, kind: "call", id: 1, method: "selection.get", params: undefined }
```

Réponse, à accepter seulement si `event.source === window.parent` :

```js
{ bobine: 1, kind: "result", id: 1, ok: true, value: { clips: [], playhead: 3.2 } }
{ bobine: 1, kind: "result", id: 1, ok: false, error: { code: "permission_denied", message: "…" } }
```

Événement poussé par Bobine :

```js
{ bobine: 1, kind: "event", name: "command", data: { id: "hello" } }
```

Méthodes : `project.get`, `selection.get`, `project.dispatch`, `project.propose`, `project.null.create`, `ui.notify` (`{ kind, text }`),
`settings.get`, `theme.get`, `native.call` (`{ method, params, timeout }`), `media.frames`, `media.encode.begin`,
`media.encode.append`, `media.encode.finish`, `media.encode.cancel` (réponse `null`). Un client minimal :

```js
let next = 1;
const waiting = new Map();
function call(method, params) {
  const id = next++;
  window.parent.postMessage({ bobine: 1, kind: "call", id, method, params }, "*");
  return new Promise((resolve, reject) => waiting.set(id, { resolve, reject }));
}
window.addEventListener("message", (event) => {
  if (event.source !== window.parent || event.data?.bobine !== 1) return;
  const m = event.data;
  if (m.kind === "result" && waiting.has(m.id)) {
    const { resolve, reject } = waiting.get(m.id);
    waiting.delete(m.id);
    m.ok
      ? resolve(m.value)
      : reject(Object.assign(new Error(m.error.message), { code: m.error.code }));
  }
  if (m.kind === "event" && m.name === "command" && m.data.id === "hello") {
    call("ui.notify", { kind: "ok", text: "Hello" });
  }
});
```

## Mettre à jour les types des commandes

`src/commands.ts` est généré depuis `schema/commands.json`, une copie du schéma JSON de la Command API de Bobine (dans
le dépôt de Bobine, `just schema` le produit dans `schema/commands.json`). Pour suivre une nouvelle version de Bobine :

1. Copie son `schema/commands.json` dans `schema/commands.json` ici.
2. `pnpm generate` réécrit `src/commands.ts` (le générateur, `scripts/generate-types.mjs`, s'arrête sur un mot-clé de
   JSON Schema qu'il ne connaît pas plutôt que de produire un type faux).
3. Relis le diff de `src/commands.ts`, lance `pnpm typecheck`, `pnpm test` et construis `examples/hello`.
4. Si une commande est retirée ou change de forme, c'est un changement incompatible : monte la version du SDK en
   conséquence.

La CI échoue si `src/commands.ts` ne correspond pas au schéma (`pnpm generate:check`).

## Développer le SDK

Voir [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

MIT, voir [LICENSE](LICENSE).
