/**
 * SDK des plugins de Bobine : un client typé du protocole 1, utilisable dans la logique comme
 * dans les panneaux d'un plugin (iframe isolée).
 *
 * ```ts
 * import { bobine } from "@bobine/plugin-sdk";
 * bobine.command("hello", () => bobine.ui.notify("ok", "Hello"));
 * ```
 */
import { createBobine } from "./client";

export type {
  Bobine,
  EventName,
  Events,
  NotifyKind,
  PluginWindow,
  SettingsValues,
  Theme,
} from "./client";
export { BobineError, createBobine } from "./client";
export type * from "./commands";
export type {
  MediaAsset,
  PluginCommand,
  PluginTransaction,
  Project,
  Selection,
  Sequence,
  Track,
  TransactionResult,
} from "./project";
export { activeSequence, FLICKS_PER_SECOND, flicks } from "./project";
export type { CallMessage, ErrorCode, EventMessage, Method, ResultMessage } from "./protocol";
export { FORBIDDEN_COMMANDS, LIMITS, METHODS, PROTOCOL } from "./protocol";
export type { ThemeTarget } from "./theme";
export { applyTheme } from "./theme";

/** Le client du plugin, branché sur `window.parent` (Bobine). */
export const bobine = createBobine();
