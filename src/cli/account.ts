/**
 * Compte Bobine pour la CLI : connexion par code e-mail à 6 chiffres (Supabase Auth, le même
 * compte que dans l'app), session gardée dans `~/.config/bobine-plugin/session.json` (droits
 * 0600) et rafraîchie quand elle expire. Le réseau passe par un `fetch` injecté (simulé en test).
 */
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_SUPABASE_URL = "https://xrlxbznwfwabrrdjldug.supabase.co";
/** Clé publique (« publishable ») du projet Supabase de Bobine, déjà dans chaque build de l'app. */
export const DEFAULT_ANON_KEY = "sb_publishable_YN1HwboTTdYVXuJuLBOexg_-Um-3qft";
export const DEFAULT_API_URL = "https://genez.app/api";

export type Fetch = typeof fetch;

export type AccountConfig = { supabaseUrl: string; anonKey: string; apiUrl: string };

/** Adresses et clé, surchargeables par l'environnement. */
export function accountConfig(env: NodeJS.ProcessEnv = process.env): AccountConfig {
  const trim = (url: string) => url.replace(/\/+$/, "");
  return {
    supabaseUrl: trim(env.BOBINE_SUPABASE_URL || DEFAULT_SUPABASE_URL),
    anonKey: env.BOBINE_SUPABASE_ANON_KEY || DEFAULT_ANON_KEY,
    apiUrl: trim(env.BOBINE_API_URL || DEFAULT_API_URL),
  };
}

export type Session = {
  email: string;
  access_token: string;
  refresh_token: string;
  /** Expiration du jeton d'accès, en secondes depuis 1970. */
  expires_at: number;
};

/** Erreur de compte, avec un message en anglais qui dit quoi faire. */
export class AccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountError";
  }
}

export function sessionPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "bobine-plugin", "session.json");
}

export function readSession(path: string): Session | null {
  try {
    const s = JSON.parse(readFileSync(path, "utf8")) as Partial<Session>;
    if (
      typeof s.access_token === "string" &&
      typeof s.refresh_token === "string" &&
      typeof s.expires_at === "number"
    ) {
      return {
        email: typeof s.email === "string" ? s.email : "",
        access_token: s.access_token,
        refresh_token: s.refresh_token,
        expires_at: s.expires_at,
      };
    }
  } catch {
    // pas de session, ou fichier illisible : on considère l'utilisateur déconnecté
  }
  return null;
}

/** Écriture atomique (fichier temporaire puis renommage), lisible par l'utilisateur seul. */
export function writeSession(path: string, session: Session): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, path);
}

export function clearSession(path: string): void {
  rmSync(path, { force: true });
}

// --- Supabase Auth ------------------------------------------------------------------------------

type AuthReply = {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  expires_in?: number;
  user?: { email?: string };
  msg?: string;
  message?: string;
  error_description?: string;
  error_code?: string;
  code?: string | number;
};

async function auth(
  cfg: AccountConfig,
  path: string,
  body: unknown,
  fetchFn: Fetch,
  bearer?: string,
): Promise<{ status: number; reply: AuthReply }> {
  let response: Response;
  try {
    response = await fetchFn(`${cfg.supabaseUrl}/auth/v1/${path}`, {
      method: "POST",
      headers: {
        apikey: cfg.anonKey,
        "Content-Type": "application/json",
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new AccountError(`could not reach ${cfg.supabaseUrl}: ${(error as Error).message}`);
  }
  const text = await response.text();
  let reply: AuthReply = {};
  try {
    reply = text ? (JSON.parse(text) as AuthReply) : {};
  } catch {
    reply = { msg: text.slice(0, 200) };
  }
  return { status: response.status, reply };
}

function detail(reply: AuthReply): string {
  return reply.msg ?? reply.error_description ?? reply.message ?? "no detail";
}

function sessionFrom(reply: AuthReply, email: string, now: number): Session {
  if (!reply.access_token || !reply.refresh_token) {
    throw new AccountError("unexpected answer from the account server: no session");
  }
  return {
    email: reply.user?.email ?? email,
    access_token: reply.access_token,
    refresh_token: reply.refresh_token,
    expires_at: reply.expires_at ?? now + (reply.expires_in ?? 3600),
  };
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** Demande l'envoi du code à 6 chiffres. Aucun compte n'est créé (`create_user: false`). */
export async function requestCode(
  cfg: AccountConfig,
  email: string,
  fetchFn: Fetch,
): Promise<void> {
  const { status, reply } = await auth(cfg, "otp", { email, create_user: false }, fetchFn);
  if (status >= 200 && status < 300) return;
  const text = detail(reply);
  if (status === 429 || reply.error_code === "over_email_send_rate_limit") {
    throw new AccountError("too many codes asked for this email: wait a minute and try again");
  }
  if (reply.error_code === "otp_disabled" || /signups? not allowed/i.test(text)) {
    throw new AccountError(
      `no Bobine account for ${email}: create one in Bobine first, then log in here`,
    );
  }
  throw new AccountError(`the account server refused to send a code (${status}): ${text}`);
}

/** Échange le code reçu contre une session. */
export async function verifyCode(
  cfg: AccountConfig,
  email: string,
  code: string,
  fetchFn: Fetch,
  now = nowSeconds(),
): Promise<Session> {
  const token = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(token)) throw new AccountError("the code has 6 digits");
  const { status, reply } = await auth(cfg, "verify", { type: "email", email, token }, fetchFn);
  if (status >= 200 && status < 300) return sessionFrom(reply, email, now);
  if (status === 429) throw new AccountError("too many attempts: wait a minute and try again");
  if (status === 401 || status === 403 || reply.error_code === "otp_expired") {
    throw new AccountError("the code is wrong or expired: run `bobine-plugin login` again");
  }
  throw new AccountError(`the account server refused the code (${status}): ${detail(reply)}`);
}

/** Nouveau jeton d'accès à partir du jeton de rafraîchissement. */
export async function refreshSession(
  cfg: AccountConfig,
  session: Session,
  fetchFn: Fetch,
  now = nowSeconds(),
): Promise<Session> {
  const { status, reply } = await auth(
    cfg,
    "token?grant_type=refresh_token",
    { refresh_token: session.refresh_token },
    fetchFn,
  );
  if (status >= 200 && status < 300) return sessionFrom(reply, session.email, now);
  throw new AccountError("your session has expired: run `bobine-plugin login`");
}

/**
 * La session enregistrée, rafraîchie si elle expire dans moins d'une minute. `null` si
 * l'utilisateur n'est pas connecté ; une session qui ne se rafraîchit plus est effacée.
 */
export async function currentSession(
  cfg: AccountConfig,
  path: string,
  fetchFn: Fetch,
  now = nowSeconds(),
): Promise<Session | null> {
  const session = readSession(path);
  if (!session) return null;
  if (session.expires_at - 60 > now) return session;
  try {
    const fresh = await refreshSession(cfg, session, fetchFn, now);
    writeSession(path, fresh);
    return fresh;
  } catch (error) {
    if (error instanceof AccountError && /expired/.test(error.message)) clearSession(path);
    throw error;
  }
}

/** Déconnexion : révoque la session côté serveur (au mieux) et efface le fichier. */
export async function logout(cfg: AccountConfig, path: string, fetchFn: Fetch): Promise<boolean> {
  const session = readSession(path);
  if (session) {
    await auth(cfg, "logout", {}, fetchFn, session.access_token).catch(() => undefined);
  }
  clearSession(path);
  return session !== null;
}

/**
 * `bobine-plugin login` : demande l'e-mail, fait envoyer le code, demande le code, enregistre la
 * session. `ask` pose une question et renvoie la réponse.
 */
export async function login(options: {
  cfg: AccountConfig;
  sessionFile: string;
  fetchFn: Fetch;
  ask: (question: string) => Promise<string>;
  log: (line: string) => void;
}): Promise<Session> {
  const { cfg, sessionFile, fetchFn, ask, log } = options;
  const previous = readSession(sessionFile);
  if (previous) log(`Logged in as ${previous.email}; a new login replaces this session.`);
  const email = (await ask("Email of your Bobine account: ")).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new AccountError("this is not an email address");
  await requestCode(cfg, email, fetchFn);
  log(`A 6-digit code was sent to ${email}.`);
  const session = await verifyCode(cfg, email, await ask("Code: "), fetchFn);
  writeSession(sessionFile, session);
  log(`Logged in as ${session.email}. Session saved in ${sessionFile}.`);
  return session;
}
