/**
 * Protocole 1 entre un plugin (dans son iframe isolée) et Bobine. Le SDK n'est qu'un client de ce
 * protocole : tout ce qu'il fait, un plugin peut le faire à la main avec `postMessage`.
 *
 * Appel du plugin : `{ bobine: 1, kind: "call", id, method, params }`, envoyé à `window.parent`.
 * Réponse :        `{ bobine: 1, kind: "result", id, ok: true, value }`
 *                  ou `{ bobine: 1, kind: "result", id, ok: false, error: { code, message } }`.
 * Événement :      `{ bobine: 1, kind: "event", name, data }`.
 */
export const PROTOCOL = 1;

export type CallMessage = {
  bobine: 1;
  kind: "call";
  id: number;
  method: Method;
  params?: unknown;
};

export type ResultMessage =
  | { bobine: 1; kind: "result"; id: number; ok: true; value: unknown }
  | { bobine: 1; kind: "result"; id: number; ok: false; error: { code: string; message: string } };

export type EventMessage = { bobine: 1; kind: "event"; name: string; data: unknown };

/**
 * Méthodes du protocole 1 et les permissions du manifeste que chacune demande, TOUTES exigées
 * (liste vide : aucune).
 */
export const METHODS = {
  "project.get": ["project:read"],
  "selection.get": ["project:read"],
  "project.propose": ["project:write"],
  "project.dispatch": ["project:write"],
  "ui.notify": [],
  "settings.get": [],
  "theme.get": [],
  "native.call": ["native:worker"],
  "media.frames": ["media:frames"],
  "media.encode.begin": ["media:frames", "project:write"],
  "media.encode.append": ["media:frames", "project:write"],
  "media.encode.finish": ["media:frames", "project:write"],
  "media.encode.cancel": ["media:frames", "project:write"],
} as const satisfies Record<string, readonly string[]>;

export type Method = keyof typeof METHODS;

/** Commandes qu'aucun plugin ne peut envoyer (comme Bob, un plugin n'importe ni fichier ni police). */
export const FORBIDDEN_COMMANDS = ["ImportMedia", "SetMediaInfo", "ImportFonts"] as const;

/** Plafonds appliqués par Bobine. */
export const LIMITS = {
  /** Appels par seconde et par plugin ; au-delà, l'appel échoue avec `rate_limited`. */
  callsPerSecond: 40,
  /** Commandes par transaction. */
  commandsPerTransaction: 500,
  /** Longueur d'un libellé, d'une notification ou d'un nom de rendu (le texte est coupé au-delà). */
  text: 200,
  /** `native.call` : délai par défaut et délai maximal, en secondes (borné entre 1 et 600). */
  nativeDefaultTimeout: 60,
  nativeMaxTimeout: 600,
  /** `native.call` : paramètres en JSON, en octets. */
  nativeParamsBytes: 1024 * 1024,
  /** `media.frames` : plus grand côté d'une image, cadence par défaut et maximale. */
  framesMaxSide: 1920,
  framesDefaultFps: 8,
  framesMaxFps: 30,
  /** `media.frames` : volume et nombre d'images d'un lot (au-delà : `too_many_frames`). */
  framesMaxBytes: 512 * 1024 * 1024,
  framesMaxCount: 20_000,
  /** `media.encode.begin` : côtés pairs ≤ 8192, aire ≤ 8192 × 4320, cadence ≤ 240. */
  encodeMaxSide: 8192,
  encodeMaxArea: 8192 * 4320,
  encodeMaxFps: 240,
} as const;

/** Codes d'erreur renvoyés par Bobine (`error.code`). */
export type ErrorCode =
  // Tout appel.
  | "unknown_method"
  | "permission_denied"
  | "invalid_params"
  | "forbidden_command"
  | "rate_limited"
  | "failed"
  // Programme natif (`native.call`, et les conditions revérifiées par `media.*`).
  /** Plugin désactivé, incompatible, permission retirée ou signature invalide. */
  | "not_allowed"
  /** Pas de programme natif pour cette plateforme. */
  | "no_worker"
  /** Le programme n'a pas pu être lancé. */
  | "spawn_failed"
  /** Un appel natif (ou un rendu) est déjà en cours pour ce plugin : un à la fois. */
  | "busy"
  /** Délai dépassé : le programme est tué. */
  | "timeout"
  /** Le programme s'est arrêté pendant l'appel ; relancé au prochain. */
  | "worker_crashed"
  /** Le plugin a été arrêté pendant l'appel (désactivé, désinstallé, app fermée). */
  | "stopped"
  /** Le programme a renvoyé un code d'erreur illisible (sinon son propre code est transmis). */
  | "worker_error"
  // Images (`media.frames`).
  /** Le média est encore en cours d'analyse. */
  | "not_ready"
  /** Le média n'a pas d'image. */
  | "no_video"
  /** Le média n'a pas pu être décodé. */
  | "decode_failed"
  /** Aucune image dans l'intervalle demandé (aussi `media.encode.finish` sans image). */
  | "no_frames"
  /** Le lot dépasse 512 Mo ou 20 000 images : demander moins. */
  | "too_many_frames"
  /** Écriture impossible dans le dossier de travail ou celui des rendus. */
  | "write_failed"
  // Rendu (`media.encode.*`).
  /** Session inconnue ou déjà fermée. */
  | "unknown_session"
  | "encode_failed"
  /** Le rendu n'a pas pu être importé (il est supprimé). */
  | "import_failed";

/** Images de `media.frames` : 1 octet par pixel (`gray`) ou 4 (`rgba`). */
export type FrameFormat = "gray" | "rgba";

type FramesRange = {
  /** Début et fin (exclue) en secondes ; tout le média ou tout le clip par défaut. */
  from?: number;
  to?: number;
  /** Boîte dans laquelle l'image tient, proportions gardées, jamais agrandie (1920 au plus). */
  width: number;
  height: number;
  format: FrameFormat;
};

/**
 * Paramètres de `media.frames` : un média (temps du média) OU un clip (secondes depuis le début
 * du clip). `fps` : 8 par défaut, 30 au plus. `every_frame` (avec `media` seulement) rend CHAQUE
 * image décodée dont l'instant est dans `[from, to)`, sans cadence : deux lots consécutifs ne se
 * recouvrent pas.
 */
export type FramesRequest =
  | (FramesRange & { clip: string; media?: never; fps?: number; every_frame?: false })
  | (FramesRange & { media: string; clip?: never; fps?: number; every_frame?: false })
  | (FramesRange & { media: string; clip?: never; every_frame: true; fps?: never });

/**
 * Réponse de `media.frames`. `raw` (images bout à bout, ligne par ligne) et `header` (JSON :
 * `count`, `width`, `height`, `format`, `fps`, `every_frame`, `bytes_per_frame`, `timestamps` en
 * secondes) sont relatifs au dossier de travail du programme natif : à lui passer tels quels.
 * Bobine garde les deux derniers lots.
 */
export type FramesResult = {
  raw: string;
  header: string;
  count: number;
  width: number;
  height: number;
};

/** Paramètres de `media.encode.begin` : taille (côtés pairs), cadence, nom du fichier sans extension. */
export type EncodeBeginRequest = {
  width: number;
  height: number;
  fps: { num: number; den: number };
  name: string;
};

/** Réponse de `media.encode.begin`, à passer aux trois autres méthodes. */
export type EncodeSession = { session: string };

/**
 * Paramètres de `media.encode.append` : `raw`, relatif au dossier de travail, contient des images
 * RGBA bout à bout (taille multiple de `width × height × 4`). Bobine le supprime, même en cas
 * d'erreur.
 */
export type EncodeAppendRequest = { session: string; raw: string };

/** Réponse de `media.encode.append` : images encodées depuis le début de la session. */
export type EncodeAppended = { frames: number };

/** Réponse de `media.encode.finish` : l'id du média importé dans le projet. */
export type EncodeFinished = { media: string };

export function isResult(data: unknown): data is ResultMessage {
  if (typeof data !== "object" || data === null) return false;
  const m = data as Record<string, unknown>;
  return m.bobine === PROTOCOL && m.kind === "result" && typeof m.id === "number";
}

export function isEvent(data: unknown): data is EventMessage {
  if (typeof data !== "object" || data === null) return false;
  const m = data as Record<string, unknown>;
  return m.bobine === PROTOCOL && m.kind === "event" && typeof m.name === "string";
}
