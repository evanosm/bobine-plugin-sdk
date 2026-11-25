import type {
  Clip,
  Command,
  Marker,
  MediaId,
  Rational,
  SequenceId,
  TrackId,
  TrackKind,
} from "./commands";
import type { FORBIDDEN_COMMANDS } from "./protocol";

/** 1 seconde = 705 600 000 flicks. Tous les temps de la Command API sont en flicks (entiers). */
export const FLICKS_PER_SECOND = 705_600_000;

/** Secondes vers flicks (arrondi à l'entier, comme l'attend la Command API). */
export function flicks(seconds: number): number {
  return Math.round(seconds * FLICKS_PER_SECOND);
}

/** Une commande qu'un plugin a le droit d'envoyer. */
export type PluginCommand = Exclude<Command, { type: (typeof FORBIDDEN_COMMANDS)[number] }>;

/** Ce que `project.dispatch` et `project.propose` reçoivent. Bobine ajoute l'origine elle-même. */
export type PluginTransaction = {
  /** Libellé court de l'historique ; Bobine le préfixe du nom du plugin. */
  label: string;
  commands: PluginCommand[];
};

/** Réponse de `project.dispatch` et `project.propose`. */
export type TransactionResult = {
  /**
   * `true` si les commandes sont appliquées. `false` si Bobine les a refusées (l'utilisateur voit
   * pourquoi) ou, pour une proposition, si l'utilisateur l'a annulée.
   */
  applied: boolean;
};

/** Sélection courante : clips sélectionnés et tête de lecture (en secondes). */
export type Selection = {
  clips: string[];
  playhead: number;
};

/**
 * Projet tel que `project.get()` le renvoie (seulement avec `project:read`). Ces types sont
 * PARTIELS : ils décrivent les champs stables les plus utiles, le projet en contient d'autres.
 */
export type Project = {
  id: string;
  format_version: number;
  media: MediaAsset[];
  sequences: Sequence[];
  active_sequence: SequenceId;
  fonts: string[];
  [field: string]: unknown;
};

export type MediaAsset = {
  id: MediaId;
  [field: string]: unknown;
};

export type Sequence = {
  id: SequenceId;
  name: string;
  width: number;
  height: number;
  fps: Rational;
  sample_rate: number;
  tracks: Track[];
  markers: Marker[];
  [field: string]: unknown;
};

export type Track = {
  id: TrackId;
  kind: TrackKind;
  name: string;
  muted: boolean;
  solo: boolean;
  locked: boolean;
  clips: Clip[];
  [field: string]: unknown;
};

/** La séquence active d'un projet, ou `null`. */
export function activeSequence(project: Project | null): Sequence | null {
  return project?.sequences.find((s) => s.id === project.active_sequence) ?? null;
}
