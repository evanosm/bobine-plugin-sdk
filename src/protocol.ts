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

/** Méthodes du protocole 1 et la permission du manifeste que chacune demande (`null` : aucune). */
export const METHODS = {
  "project.get": "project:read",
  "selection.get": "project:read",
  "project.propose": "project:write",
  "project.dispatch": "project:write",
  "ui.notify": null,
  "settings.get": null,
  "theme.get": null,
} as const;

export type Method = keyof typeof METHODS;

/** Commandes qu'aucun plugin ne peut envoyer (comme Bob, un plugin n'importe ni fichier ni police). */
export const FORBIDDEN_COMMANDS = ["ImportMedia", "SetMediaInfo", "ImportFonts"] as const;

/** Plafonds appliqués par Bobine. */
export const LIMITS = {
  /** Appels par seconde et par plugin ; au-delà, l'appel échoue avec `rate_limited`. */
  callsPerSecond: 40,
  /** Commandes par transaction. */
  commandsPerTransaction: 500,
  /** Longueur d'un libellé ou d'une notification (le texte est coupé au-delà). */
  text: 200,
} as const;

/** Codes d'erreur renvoyés par Bobine (`error.code`). */
export type ErrorCode =
  | "unknown_method"
  | "permission_denied"
  | "invalid_params"
  | "forbidden_command"
  | "rate_limited"
  | "failed";

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
