import type { PluginTransaction, Project, Selection, TransactionResult } from "./project";
import {
  type EncodeAppended,
  type EncodeAppendRequest,
  type EncodeBeginRequest,
  type EncodeFinished,
  type EncodeSession,
  type ErrorCode,
  type FramesRequest,
  type FramesResult,
  isEvent,
  isResult,
  type Method,
  PROTOCOL,
  type Thumbnail,
  type ThumbnailRequest,
} from "./protocol";

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
  /**
   * La sélection ou la tête de lecture a changé (seulement avec `project:read`), au plus une fois
   * par 150 ms : mêmes données que `selection.get()`.
   */
  selection: Selection;
  /** Message envoyé par une autre iframe du même plugin avec `post` (panneau ↔ logique). */
  message: unknown;
  /**
   * Progression de l'appel natif en cours (0 à 1, ou `null` : inconnue), telle que le programme
   * la donne ; la barre des tâches de fond de Bobine montre la même.
   */
  progress: { value: number | null };
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
    native: {
      /**
       * Appelle la méthode `method` du programme natif du plugin (permission `native:worker`) et
       * renvoie son résultat. `timeout` en secondes : 60 par défaut, 600 au plus ; au-delà, le
       * programme est tué (`timeout`). Un appel à la fois par plugin (`busy`).
       */
      call: <T = unknown>(method: string, params?: unknown, options?: { timeout?: number }) =>
        call("native.call", { method, params, timeout: options?.timeout }) as Promise<T>,
      /**
       * Arrête le programme natif (bouton Annuler) : l'appel en cours échoue en `stopped`, le rendu
       * ouvert (`media.encode`) est annulé et son fichier partiel supprimé. Le prochain appel
       * relance le programme.
       */
      stop: async (): Promise<void> => {
        await call("native.stop");
      },
    },
    media: {
      /**
       * Décode les images d'un média ou d'un clip dans le dossier de travail du programme natif
       * (permission `media:frames`) ; les chemins renvoyés sont à lui passer.
       */
      frames: (request: FramesRequest) => call("media.frames", request) as Promise<FramesResult>,
      /**
       * Vignette d'un média à un instant (permission `media:frames`), pour un panneau : les
       * vignettes de l'app, mises en cache, sans passer par le programme natif.
       */
      thumbnail: (request: ThumbnailRequest) =>
        call("media.thumbnail", request) as Promise<Thumbnail>,
      /**
       * Rendu ProRes 422 (`.mov` sans son) d'images RGBA écrites par le programme natif, importé
       * dans le projet à la fin (permissions `media:frames` et `project:write`). Une session à la
       * fois par plugin.
       */
      encode: {
        begin: (request: EncodeBeginRequest) =>
          call("media.encode.begin", request) as Promise<EncodeSession>,
        append: (request: EncodeAppendRequest) =>
          call("media.encode.append", request) as Promise<EncodeAppended>,
        /** Ferme le fichier et l'importe (une étape d'historique) : renvoie l'id du média. */
        finish: (request: EncodeSession) =>
          call("media.encode.finish", request) as Promise<EncodeFinished>,
        /** Abandonne le rendu : le fichier partiel est supprimé. */
        cancel: async (request: EncodeSession): Promise<void> => {
          await call("media.encode.cancel", request);
        },
      },
    },
    on,
    /**
     * Envoie `data` (JSON, 64 Ko au plus) aux AUTRES iframes du plugin, reçu en événement
     * `message` : un panneau demande un calcul à la logique, qui survit à sa fermeture.
     */
    async post(data: unknown): Promise<void> {
      await call("plugin.post", data);
    },
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
