// Connexion, session et publication avec un `fetch` simulé : aucun appel réseau réel.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  AccountError,
  accountConfig,
  currentSession,
  type Fetch,
  login,
  logout,
  readSession,
  requestCode,
  type Session,
  verifyCode,
  writeSession,
} from "../src/cli/account";
import {
  catalogUrl,
  MAX_PUBLISH_BYTES,
  PublishError,
  publishArchive,
  publishFolder,
} from "../src/cli/publish";

const temp = realpathSync(mkdtempSync(join(tmpdir(), "bobine-account-")));
afterAll(() => rmSync(temp, { recursive: true, force: true }));
let n = 0;
const fresh = () => join(temp, `case-${++n}`);

const cfg = accountConfig({
  BOBINE_SUPABASE_URL: "https://auth.test/",
  BOBINE_SUPABASE_ANON_KEY: "anon-key",
  BOBINE_API_URL: "https://api.test",
});

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

/** Un faux `fetch` : `reply(url, body)` donne le statut et le corps JSON de la réponse. */
function fakeFetch(reply: (url: string, body: unknown) => [number, unknown]) {
  const calls: Call[] = [];
  const fetchFn: Fetch = async (input, init) => {
    const url = String(input);
    const raw = init?.body;
    const body =
      raw instanceof Uint8Array ? Buffer.from(raw) : raw ? JSON.parse(String(raw)) : null;
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body,
    });
    const [status, json] = reply(url, body);
    return new Response(json === undefined ? null : JSON.stringify(json), { status });
  };
  return { fetchFn, calls };
}

const NOW = 1_800_000_000;
const session = (over: Partial<Session> = {}): Session => ({
  email: "dev@example.com",
  access_token: "access-1",
  refresh_token: "refresh-1",
  expires_at: NOW + 3600,
  ...over,
});
const tokens = { access_token: "access-2", refresh_token: "refresh-2", expires_at: NOW + 7200 };

describe("account config", () => {
  it("uses Bobine's servers by default and lets the environment override them", () => {
    expect(accountConfig({}).supabaseUrl).toBe("https://xrlxbznwfwabrrdjldug.supabase.co");
    expect(accountConfig({}).apiUrl).toBe("https://genez.app/api");
    expect(accountConfig({}).anonKey).toMatch(/^sb_publishable_/);
    expect(cfg).toEqual({
      supabaseUrl: "https://auth.test",
      anonKey: "anon-key",
      apiUrl: "https://api.test",
    });
  });
});

describe("login", () => {
  it("asks Supabase for a code without creating an account", async () => {
    const { fetchFn, calls } = fakeFetch(() => [200, {}]);
    await requestCode(cfg, "dev@example.com", fetchFn);
    expect(calls).toEqual([
      {
        url: "https://auth.test/auth/v1/otp",
        method: "POST",
        headers: { apikey: "anon-key", "Content-Type": "application/json" },
        body: { email: "dev@example.com", create_user: false },
      },
    ]);
  });

  it("says when the email has no Bobine account or asks too often", async () => {
    const unknown = fakeFetch(() => [
      422,
      { error_code: "otp_disabled", msg: "Signups not allowed for otp" },
    ]);
    await expect(requestCode(cfg, "x@example.com", unknown.fetchFn)).rejects.toThrow(
      /no Bobine account/,
    );
    const limited = fakeFetch(() => [429, { msg: "rate limit" }]);
    await expect(requestCode(cfg, "x@example.com", limited.fetchFn)).rejects.toThrow(
      /too many codes/,
    );
  });

  it("exchanges the 6-digit code for a session", async () => {
    const { fetchFn, calls } = fakeFetch(() => [
      200,
      { ...tokens, user: { email: "dev@example.com" } },
    ]);
    const s = await verifyCode(cfg, "dev@example.com", " 123 456 ", fetchFn, NOW);
    expect(calls[0]?.url).toBe("https://auth.test/auth/v1/verify");
    expect(calls[0]?.body).toEqual({ type: "email", email: "dev@example.com", token: "123456" });
    expect(s).toEqual({ email: "dev@example.com", ...tokens });
  });

  it("computes expires_at from expires_in when Supabase omits it", async () => {
    const { fetchFn } = fakeFetch(() => [
      200,
      { access_token: "a", refresh_token: "r", expires_in: 3600 },
    ]);
    expect((await verifyCode(cfg, "d@e.co", "123456", fetchFn, NOW)).expires_at).toBe(NOW + 3600);
  });

  it("refuses a malformed code without calling the server, and a wrong one after", async () => {
    const { fetchFn, calls } = fakeFetch(() => [
      403,
      { error_code: "otp_expired", msg: "Token has expired or is invalid" },
    ]);
    await expect(verifyCode(cfg, "d@e.co", "12ab", fetchFn)).rejects.toThrow(/6 digits/);
    expect(calls).toHaveLength(0);
    await expect(verifyCode(cfg, "d@e.co", "000000", fetchFn)).rejects.toThrow(/wrong or expired/);
  });

  it("saves the session atomically, readable by the user only", async () => {
    const file = join(fresh(), "bobine-plugin", "session.json");
    const answers = ["Dev@Example.com", "123456"];
    const lines: string[] = [];
    const { fetchFn, calls } = fakeFetch((url) =>
      url.endsWith("/otp") ? [200, {}] : [200, { ...tokens, user: { email: "dev@example.com" } }],
    );
    await login({
      cfg,
      sessionFile: file,
      fetchFn,
      ask: async () => answers.shift() ?? "",
      log: (l) => lines.push(l),
    });
    expect(calls.map((c) => c.body)).toEqual([
      { email: "dev@example.com", create_user: false },
      { type: "email", email: "dev@example.com", token: "123456" },
    ]);
    expect(readSession(file)).toEqual({ email: "dev@example.com", ...tokens });
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(file, ".."))).toEqual(["session.json"]);
    expect(lines.at(-1)).toMatch(/Logged in as dev@example.com/);
  });
});

describe("session", () => {
  it("uses a session that has not expired without calling the server", async () => {
    const file = join(fresh(), "session.json");
    writeSession(file, session());
    const { fetchFn, calls } = fakeFetch(() => [500, {}]);
    expect(await currentSession(cfg, file, fetchFn, NOW)).toEqual(session());
    expect(calls).toHaveLength(0);
  });

  it("refreshes an expired session and saves the new tokens", async () => {
    const file = join(fresh(), "session.json");
    writeSession(file, session({ expires_at: NOW - 10 }));
    const { fetchFn, calls } = fakeFetch(() => [200, tokens]);
    const s = await currentSession(cfg, file, fetchFn, NOW);
    expect(calls[0]?.url).toBe("https://auth.test/auth/v1/token?grant_type=refresh_token");
    expect(calls[0]?.headers.apikey).toBe("anon-key");
    expect(calls[0]?.body).toEqual({ refresh_token: "refresh-1" });
    expect(s).toEqual({ email: "dev@example.com", ...tokens });
    expect(readSession(file)).toEqual(s);
  });

  it("forgets a session that cannot be refreshed anymore", async () => {
    const file = join(fresh(), "session.json");
    writeSession(file, session({ expires_at: NOW - 10 }));
    const { fetchFn } = fakeFetch(() => [400, { error_code: "refresh_token_not_found" }]);
    await expect(currentSession(cfg, file, fetchFn, NOW)).rejects.toThrow(/bobine-plugin login/);
    expect(existsSync(file)).toBe(false);
  });

  it("logs out: revokes the session on the server and deletes the file", async () => {
    const file = join(fresh(), "session.json");
    writeSession(file, session());
    const { fetchFn, calls } = fakeFetch(() => [204, undefined]);
    expect(await logout(cfg, file, fetchFn)).toBe(true);
    expect(calls[0]?.url).toBe("https://auth.test/auth/v1/logout");
    expect(calls[0]?.headers.Authorization).toBe("Bearer access-1");
    expect(existsSync(file)).toBe(false);
    expect(await logout(cfg, file, fetchFn)).toBe(false);
    expect(calls).toHaveLength(1);
  });
});

const target = { id: "someone.podcast", version: "1.0.0" };
const archive = Buffer.from("PK fake archive");

describe("publish", () => {
  it("sends the raw archive with the access token and returns the published version", async () => {
    const published = {
      id: "someone.podcast",
      version: "1.0.0",
      sha256: "ab".repeat(32),
      size: 999,
    };
    const { fetchFn, calls } = fakeFetch(() => [201, published]);
    expect(await publishArchive(cfg, "access-1", archive, target, fetchFn)).toEqual(published);
    expect(calls[0]?.url).toBe("https://api.test/v1/extensions/publish");
    expect(calls[0]?.headers).toEqual({
      Authorization: "Bearer access-1",
      "Content-Type": "application/octet-stream",
    });
    expect(calls[0]?.body).toEqual(archive);
    expect(catalogUrl(cfg, "someone.podcast")).toBe(
      "https://api.test/v1/extensions/someone.podcast",
    );
  });

  const refusals: [number, string, RegExp][] = [
    [401, "unauthorized", /bobine-plugin login/],
    [403, "account_suspended", /suspended/],
    [403, "reserved_namespace", /reserved for Genez: change `id`/],
    [403, "native_not_allowed", /remove them from bobine.json/],
    [403, "not_owner", /belongs to another account/],
    [409, "version_exists", /raise `version` in bobine.json/],
    [413, "payload_too_large", /larger than 50 MB/],
    [429, "rate_limited", /try again later/],
    [400, "invalid_manifest", /refused the package: bad id\. Run `bobine-plugin check`/],
  ];
  for (const [status, code, message] of refusals) {
    it(`explains a ${status} ${code} refusal`, async () => {
      const { fetchFn } = fakeFetch(() => [status, { error: { code, message: "bad id" } }]);
      const error = await publishArchive(cfg, "t", archive, target, fetchFn).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(PublishError);
      expect((error as PublishError).code).toBe(code);
      expect((error as PublishError).message).toMatch(message);
    });
  }

  it("explains a server failure and an unreachable server", async () => {
    const failing = fakeFetch(() => [
      502,
      { error: { code: "upstream_error", message: "storage" } },
    ]);
    await expect(publishArchive(cfg, "t", archive, target, failing.fetchFn)).rejects.toThrow(
      /failed \(502\)/,
    );
    const offline: Fetch = async () => {
      throw new TypeError("fetch failed");
    };
    await expect(publishArchive(cfg, "t", archive, target, offline)).rejects.toThrow(
      /could not reach https:\/\/api.test/,
    );
  });

  it("refuses an archive over 50 MB without sending it", async () => {
    const { fetchFn, calls } = fakeFetch(() => [201, {}]);
    const big = Buffer.alloc(MAX_PUBLISH_BYTES + 1);
    await expect(publishArchive(cfg, "t", big, target, fetchFn)).rejects.toThrow(/50 MB/);
    expect(calls).toHaveLength(0);
  });
});

describe("publish command", () => {
  function skillFolder(): string {
    const dir = fresh();
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "bobine.json"),
      JSON.stringify({
        id: "someone.podcast",
        kind: "skill",
        name: { en: "Podcast" },
        version: "1.0.0",
        api: "1",
        skill: "skill.md",
      }),
    );
    writeFileSync(join(dir, "skill.md"), "Short shots.");
    return dir;
  }

  function options(sessionFile: string, fetchFn: Fetch, answer: boolean, lines: string[] = []) {
    return {
      cfg,
      sessionFile,
      fetchFn,
      log: (l: string) => lines.push(l),
      confirm: async () => answer,
      out: join(temp, `out-${++n}.bobine-ext`),
    };
  }

  it("needs a login first", async () => {
    const { fetchFn } = fakeFetch(() => [201, {}]);
    await expect(
      publishFolder(skillFolder(), options(join(fresh(), "s.json"), fetchFn, true)),
    ).rejects.toThrow(AccountError);
  });

  it("says the publication is public and final, and sends nothing if the user says no", async () => {
    const file = join(fresh(), "session.json");
    writeSession(file, session({ expires_at: Math.floor(Date.now() / 1000) + 3600 }));
    const lines: string[] = [];
    const { fetchFn, calls } = fakeFetch(() => [201, {}]);
    expect(await publishFolder(skillFolder(), options(file, fetchFn, false, lines))).toBeNull();
    expect(lines.join("\n")).toMatch(/public in the Bobine catalog[\s\S]*final for this version/);
    expect(calls).toHaveLength(0);
  });

  it("checks, packs and publishes the archive it made", async () => {
    const file = join(fresh(), "session.json");
    writeSession(file, session({ expires_at: Math.floor(Date.now() / 1000) + 3600 }));
    const published = { id: "someone.podcast", version: "1.0.0", sha256: "00", size: 10 };
    const { fetchFn, calls } = fakeFetch(() => [201, published]);
    const opts = options(file, fetchFn, true);
    expect(await publishFolder(skillFolder(), opts)).toEqual(published);
    expect(calls[0]?.body).toEqual(readFileSync(opts.out));
  });

  it("forgets the session when the marketplace answers 401", async () => {
    const file = join(fresh(), "session.json");
    writeSession(file, session({ expires_at: Math.floor(Date.now() / 1000) + 3600 }));
    const { fetchFn } = fakeFetch(() => [
      401,
      { error: { code: "unauthorized", message: "no session" } },
    ]);
    await expect(publishFolder(skillFolder(), options(file, fetchFn, true))).rejects.toThrow(
      PublishError,
    );
    expect(existsSync(file)).toBe(false);
  });
});
