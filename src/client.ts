import type { PluginTransaction, Project, Selection, TransactionResult } from "./project";
import { type ErrorCode, isEvent, isResult, type Method, PROTOCOL } from "./protocol";

/** Valeurs des réglages déclarés dans `contributes.settings` du manifeste. */
export type SettingsValues = Record<string, boolean | number | string>;

/** Couleurs et rayons du thème actif de Bobine (valeurs CSS déjà résolues). */
export type Theme = {
  mode: "light" | "dark";
  tokens: Record<string, string>;
};

export type NotifyKind = "info" | "ok" | "error";

/** Événements poussés par Bobine et leurs données. */
export type Events = {
  /** Une commande déclarée par le plugin a été lancée (palette, menu, clic droit). */
  command: { id: string };
  /** Le projet a changé (seulement avec `project:read`) ; le contenu se demande avec `project.get()`. */
  project: null;
  /** Un réglage a changé dans « Mes extensions » : toutes les valeurs à jour. */
  settings: SettingsValues;
  /** Le thème de Bobine a changé (et à l'ouverture d'un panneau). */
  theme: Theme;
};

export type EventName = keyof Events;

/** Erreur renvoyée par Bobine : `code` dit pourquoi (voir `ErrorCode`). */
export class BobineError extends Error {
  readonly code: ErrorCode | (string & {});

  constructor(code: string, message: string) {
    super(message);
    this.name = "BobineError";
    this.code = code;
  }
}

/** Le minimum de `window` dont le client a besoin (un faux suffit dans les tests). */
export type PluginWindow = {
  readonly parent: unknown;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
};

type Pending = { resolve: (value: unknown) => void; reject: (error: BobineError) => void };

export type Bobine = ReturnType<typeof createBobine>;

/**
 * Crée un client du protocole 1. Le plugin parle à `window.parent` (Bobine) ; seules les réponses
 * venues de `window.parent` sont acceptées. L'écoute commence au premier appel ou abonnement.
 */
export function createBobine(getWindow: () => PluginWindow = () => window) {
  let win: PluginWindow | null = null;
  let nextId = 1;
  const pending = new Map<number, Pending>();
  const handlers = new Map<string, Set<(data: unknown) => void>>();

  function start(): PluginWindow {
    if (win) return win;
    const w = getWindow();
    win = w;
    w.addEventListener("message", (event) => {
      if (event.source !== w.parent) return;
      const data: unknown = event.data;
      if (isResult(data)) {
        const waiting = pending.get(data.id);
        if (!waiting) return;
        pending.delete(data.id);
        if (data.ok) waiting.resolve(data.value);
        else waiting.reject(new BobineError(data.error.code, data.error.message));
      } else if (isEvent(data)) {
        for (const handler of handlers.get(data.name) ?? []) handler(data.data);
      }
    });
    return w;
  }

  /** Appel brut d'une méthode du protocole. */
  function call(method: Method, params?: unknown): Promise<unknown> {
    const w = start();
    const id = nextId++;
    const parent = w.parent as { postMessage(message: unknown, targetOrigin: string): void };
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      // Le plugin a une origine opaque : seul « * » atteint Bobine, le destinataire est fixé par
      // la fenêtre visée (`window.parent`).
      parent.postMessage({ bobine: PROTOCOL, kind: "call", id, method, params }, "*");
    });
  }

  function on<K extends EventName>(name: K, handler: (data: Events[K]) => void): () => void {
    start();
    let set = handlers.get(name);
    if (!set) {
      set = new Set();
      handlers.set(name, set);
    }
    const listener = handler as (data: unknown) => void;
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  const ui = {
    /** Affiche une notification dans Bobine, préfixée du nom du plugin (200 caractères au plus). */
    async notify(kind: NotifyKind, text: string): Promise<void> {
      await call("ui.notify", { kind, text });
    },
  };

  return {
    project: {
      /** Le projet ouvert, ou `null` (permission `project:read`). */
      get: () => call("project.get") as Promise<Project | null>,
      /**
       * Applique des commandes en une étape d'historique annulable (permission `project:write`).
       */
      dispatch: (tx: PluginTransaction) =>
        call("project.dispatch", tx) as Promise<TransactionResult>,
      /**
       * Montre les commandes en proposition sur la timeline ; l'utilisateur applique ou annule
       * (permission `project:write`). La promesse attend sa réponse.
       */
      propose: (tx: PluginTransaction) => call("project.propose", tx) as Promise<TransactionResult>,
    },
    selection: {
      /** Clips sélectionnés et tête de lecture en secondes (permission `project:read`). */
      get: () => call("selection.get") as Promise<Selection>,
    },
    ui,
    settings: {
      /** Valeurs des réglages déclarés (défaut du manifeste si l'utilisateur n'a rien changé). */
      get: <T extends SettingsValues = SettingsValues>() => call("settings.get") as Promise<T>,
    },
    theme: {
      /** Couleurs et rayons du thème actif. */
      get: () => call("theme.get") as Promise<Theme>,
    },
    on,
    /**
     * Lance `handler` quand la commande `id` (déclarée dans `contributes.commands`) est choisie.
     * Une erreur du handler s'affiche dans Bobine en notification d'erreur.
     */
    command(id: string, handler: () => void | Promise<void>): () => void {
      return on("command", (data) => {
        if (data?.id !== id) return;
        Promise.resolve()
          .then(handler)
          .catch((error: unknown) => {
            const text = error instanceof Error ? error.message : String(error);
            console.error(error);
            void ui.notify("error", text || id).catch(() => undefined);
          });
      });
    },
    call,
  };
}
