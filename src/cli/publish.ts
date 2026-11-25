/**
 * Publication sur la marketplace de Bobine : `POST {API}/v1/extensions/publish`, corps = l'archive
 * `.bobine-ext` brute. Le serveur re-signe le paquet ; une version publiée ne change jamais.
 * Contrat : genez-suite-web, `src/server/api/CONTRACT.md`, section Extensions.
 */
import { readFileSync } from "node:fs";
import {
  type AccountConfig,
  AccountError,
  clearSession,
  currentSession,
  type Fetch,
} from "./account";
import { pack } from "./pack";

/** Plafond du serveur pour une archive. */
export const MAX_PUBLISH_BYTES = 50 * 1024 * 1024;

export type Published = { id: string; version: string; sha256: string; size: number };

/** Publication refusée : statut HTTP, `code` du serveur et message en anglais qui dit quoi faire. */
export class PublishError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PublishError";
  }
}

/** Adresse de la fiche dans le catalogue (API publique, lisible sans compte). */
export function catalogUrl(cfg: AccountConfig, id: string): string {
  return `${cfg.apiUrl}/v1/extensions/${encodeURIComponent(id)}`;
}

/** Le message à montrer pour un refus du serveur. */
export function explainRefusal(
  status: number,
  code: string,
  detail: string,
  target: { id: string; version: string },
): string {
  const { id, version } = target;
  switch (code) {
    case "unauthorized":
      return "your session is not valid anymore: run `bobine-plugin login`, then publish again";
    case "account_suspended":
      return "your account is suspended, so it cannot publish: contact Genez";
    case "reserved_namespace":
      return `ids starting with \`genez.\` or \`bobine.\` are reserved for Genez: change \`id\` in bobine.json (e.g. \`yourname.${id.split(".")[1] ?? "name"}\`)`;
    case "native_not_allowed":
      return "native programs (`native` field, `native:worker` permission) are reserved for Genez plugins: remove them from bobine.json";
    case "not_owner":
      return `\`${id}\` belongs to another account: choose another \`id\` in bobine.json, or log in with the account that published it`;
    case "version_exists":
      return `${id} ${version} is already published and a published version never changes: raise \`version\` in bobine.json, then publish again`;
    case "payload_too_large":
      return "the archive is larger than 50 MB: move out of the folder what Bobine does not need, then publish again";
    case "rate_limited":
      return "20 publications per account in 24 hours at most: try again later";
    case "invalid_manifest":
      return `the server refused the package: ${detail}. Run \`bobine-plugin check\` with the latest SDK`;
  }
  if (status === 401) return explainRefusal(status, "unauthorized", detail, target);
  if (status === 413) return explainRefusal(status, "payload_too_large", detail, target);
  if (status === 429) return explainRefusal(status, "rate_limited", detail, target);
  if (status >= 500) return `the marketplace failed (${status}): try again later. ${detail}`;
  return `the marketplace refused the package (${status} ${code}): ${detail}`;
}

/** Envoie l'archive. Lève `PublishError` en cas de refus. */
export async function publishArchive(
  cfg: AccountConfig,
  accessToken: string,
  archive: Buffer,
  target: { id: string; version: string },
  fetchFn: Fetch,
): Promise<Published> {
  if (archive.length > MAX_PUBLISH_BYTES) {
    throw new PublishError(
      413,
      "payload_too_large",
      explainRefusal(413, "payload_too_large", "", target),
    );
  }
  let response: Response;
  try {
    response = await fetchFn(`${cfg.apiUrl}/v1/extensions/publish`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/octet-stream",
      },
      body: new Uint8Array(archive),
      signal: AbortSignal.timeout(300_000),
    });
  } catch (error) {
    throw new PublishError(
      0,
      "network",
      `could not reach ${cfg.apiUrl}: ${(error as Error).message}`,
    );
  }
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (response.status === 201 || response.status === 200) {
    const p = body as Partial<Published> | null;
    if (p && typeof p.id === "string" && typeof p.version === "string") {
      return {
        id: p.id,
        version: p.version,
        sha256: String(p.sha256 ?? ""),
        size: Number(p.size ?? 0),
      };
    }
    throw new PublishError(response.status, "unexpected", "unexpected answer from the marketplace");
  }
  const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
  const code = error?.code ?? "";
  const detail = error?.message ?? text.slice(0, 200);
  throw new PublishError(
    response.status,
    code,
    explainRefusal(response.status, code, detail, target),
  );
}

export type PublishOptions = {
  cfg: AccountConfig;
  sessionFile: string;
  fetchFn: Fetch;
  /** Demande la confirmation ; `false` annule. */
  confirm: (question: string) => Promise<boolean>;
  log: (line: string) => void;
  out?: string;
};

/**
 * `bobine-plugin publish` : session valide, `check` et `pack`, rappel que la publication est
 * publique et définitive, puis envoi. Renvoie `null` si l'utilisateur annule.
 */
export async function publishFolder(
  dir: string,
  options: PublishOptions,
): Promise<Published | null> {
  const { cfg, sessionFile, fetchFn, confirm, log } = options;
  const session = await currentSession(cfg, sessionFile, fetchFn);
  if (!session) throw new AccountError("you are not logged in: run `bobine-plugin login` first");
  const packed = pack(dir, options.out);
  const { id, version } = packed.manifest;
  for (const warning of packed.warnings) log(`warning: ${warning}`);
  log(
    `Packed ${id} ${version}: ${packed.count} file(s), ${packed.bytes} bytes -> ${packed.archive}`,
  );
  log(
    `Publishing makes ${id} ${version} public in the Bobine catalog, as ${session.email || "your account"}.` +
      "\nThis is final for this version: it can never be changed. To fix something, publish a new version.",
  );
  if (!(await confirm("Publish now? [y/N] "))) return null;
  try {
    return await publishArchive(
      cfg,
      session.access_token,
      readFileSync(packed.archive),
      { id, version },
      fetchFn,
    );
  } catch (error) {
    if (error instanceof PublishError && error.status === 401) clearSession(sessionFile);
    throw error;
  }
}
