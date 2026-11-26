import { describe, expect, it, vi } from "vitest";
import { BobineError, createBobine, type PluginWindow } from "../src/client";
import type { PluginCommand } from "../src/project";
import { type FramesRequest, METHODS } from "../src/protocol";
import { applyTheme } from "../src/theme";

type Posted = { message: Record<string, unknown>; origin: string };

/** Une fausse fenêtre de plugin : `parent` (Bobine) note ce qu'on lui envoie. */
function fakeWindow() {
  const posted: Posted[] = [];
  const parent = {
    postMessage(message: Record<string, unknown>, origin: string) {
      posted.push({ message, origin });
    },
  };
  let listener: ((event: MessageEvent) => void) | null = null;
  const win: PluginWindow = {
    parent,
    addEventListener(_type, l) {
      listener = l;
    },
  };
  const receive = (data: unknown, source: unknown = parent) =>
    listener?.({ data, source } as MessageEvent);
  return { win, posted, parent, receive };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("client", () => {
  it("sends calls to window.parent with the * target and resolves with the result", async () => {
    const { win, posted, receive } = fakeWindow();
    const bobine = createBobine(() => win);
    const promise = bobine.selection.get();
    expect(posted).toEqual([
      {
        message: { bobine: 1, kind: "call", id: 1, method: "selection.get", params: undefined },
        origin: "*",
      },
    ]);
    receive({ bobine: 1, kind: "result", id: 1, ok: true, value: { clips: ["c1"], playhead: 2 } });
    await expect(promise).resolves.toEqual({ clips: ["c1"], playhead: 2 });
  });

  it("ignores replies that do not come from window.parent", async () => {
    const { win, receive } = fakeWindow();
    const bobine = createBobine(() => win);
    const promise = bobine.project.get();
    receive({ bobine: 1, kind: "result", id: 1, ok: true, value: "forged" }, {});
    receive({ bobine: 1, kind: "result", id: 1, ok: true, value: null });
    await expect(promise).resolves.toBeNull();
  });

  it("rejects with a BobineError that carries Bobine's code", async () => {
    const { win, receive } = fakeWindow();
    const bobine = createBobine(() => win);
    const promise = bobine.project.dispatch({ label: "x", commands: [] });
    receive({
      bobine: 1,
      kind: "result",
      id: 1,
      ok: false,
      error: { code: "permission_denied", message: "project.dispatch needs project_write" },
    });
    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BobineError);
    expect((error as BobineError).code).toBe("permission_denied");
  });

  it("sends the transaction as params of project.propose", () => {
    const { win, posted } = fakeWindow();
    const bobine = createBobine(() => win);
    const tx = {
      label: "Marker",
      commands: [
        {
          type: "AddMarker" as const,
          marker: {
            id: "m",
            time: 0,
            duration: 0,
            label: "",
            color: "red" as const,
            resolved: false,
          },
        },
      ],
    };
    void bobine.project.propose(tx);
    void bobine.ui.notify("ok", "Done");
    expect(posted.map((p) => [p.message.method, p.message.params])).toEqual([
      ["project.propose", tx],
      ["ui.notify", { kind: "ok", text: "Done" }],
    ]);
  });

  it("delivers events to handlers until they unsubscribe", () => {
    const { win, receive } = fakeWindow();
    const bobine = createBobine(() => win);
    const seen: unknown[] = [];
    const off = bobine.on("settings", (values) => seen.push(values));
    receive({ bobine: 1, kind: "event", name: "settings", data: { color: "red" } });
    off();
    receive({ bobine: 1, kind: "event", name: "settings", data: { color: "blue" } });
    expect(seen).toEqual([{ color: "red" }]);
  });

  it("runs a command handler only for its own id", async () => {
    const { win, receive } = fakeWindow();
    const bobine = createBobine(() => win);
    const handler = vi.fn();
    bobine.command("mark", handler);
    receive({ bobine: 1, kind: "event", name: "command", data: { id: "other" } });
    receive({ bobine: 1, kind: "event", name: "command", data: { id: "mark" } });
    await flush();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("shows a failing command handler as an error notification", async () => {
    const { win, posted, receive } = fakeWindow();
    const bobine = createBobine(() => win);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    bobine.command("mark", () => {
      throw new Error("No sequence");
    });
    receive({ bobine: 1, kind: "event", name: "command", data: { id: "mark" } });
    await flush();
    expect(posted.at(-1)?.message).toMatchObject({
      method: "ui.notify",
      params: { kind: "error", text: "No sequence" },
    });
  });

  it("sends native.call with the worker method, its params and the timeout", async () => {
    const { win, posted, receive } = fakeWindow();
    const bobine = createBobine(() => win);
    const promise = bobine.native.call<{ ok: boolean }>("track", { clip: "c1" }, { timeout: 300 });
    expect(posted[0]?.message).toMatchObject({
      method: "native.call",
      params: { method: "track", params: { clip: "c1" }, timeout: 300 },
    });
    receive({ bobine: 1, kind: "result", id: 1, ok: true, value: { ok: true } });
    await expect(promise).resolves.toEqual({ ok: true });
  });

  it("passes the worker's own error code through BobineError", async () => {
    const { win, receive } = fakeWindow();
    const bobine = createBobine(() => win);
    const promise = bobine.native.call("track");
    receive({
      bobine: 1,
      kind: "result",
      id: 1,
      ok: false,
      error: { code: "lost_target", message: "the target left the image" },
    });
    const error = await promise.catch((e: unknown) => e);
    expect((error as BobineError).code).toBe("lost_target");
  });

  it("asks a media thumbnail for a panel and returns its RGBA pixels", async () => {
    const { win, posted, receive } = fakeWindow();
    const bobine = createBobine(() => win);
    const promise = bobine.media.thumbnail({ media: "m1", time: 2.5, height: 180 });
    expect(posted[0]?.message).toMatchObject({
      method: "media.thumbnail",
      params: { media: "m1", time: 2.5, height: 180 },
    });
    const value = { width: 320, height: 180, rgba_base64: "AAAA" };
    receive({ bobine: 1, kind: "result", id: 1, ok: true, value });
    await expect(promise).resolves.toEqual(value);
  });

  it("posts a message to the plugin's other frames and receives theirs as events", async () => {
    const { win, posted, receive } = fakeWindow();
    const bobine = createBobine(() => win);
    const seen: unknown[] = [];
    bobine.on("message", (data) => seen.push(data));
    const sent = bobine.post({ type: "run" });
    expect(posted[0]?.message).toMatchObject({ method: "plugin.post", params: { type: "run" } });
    receive({ bobine: 1, kind: "result", id: 1, ok: true, value: null });
    await sent;
    receive({ bobine: 1, kind: "event", name: "message", data: { type: "status", busy: true } });
    receive({ bobine: 1, kind: "event", name: "selection", data: { clips: ["c1"], playhead: 3 } });
    expect(seen).toEqual([{ type: "status", busy: true }]);
  });

  it("stops the native program on request and passes its progress as an event", async () => {
    const { win, posted, receive } = fakeWindow();
    const bobine = createBobine(() => win);
    const seen: unknown[] = [];
    bobine.on("progress", (data) => seen.push(data.value));
    const stopped = bobine.native.stop();
    expect(posted[0]?.message).toMatchObject({ method: "native.stop" });
    receive({ bobine: 1, kind: "result", id: 1, ok: true, value: null });
    await stopped;
    receive({ bobine: 1, kind: "event", name: "progress", data: { value: 0.25 } });
    expect(seen).toEqual([0.25]);
  });

  it("sends media.frames with every_frame for a media and returns the paths", async () => {
    const { win, posted, receive } = fakeWindow();
    const bobine = createBobine(() => win);
    const request = {
      media: "m1",
      from: 0,
      to: 1,
      width: 1920,
      height: 1080,
      format: "rgba" as const,
      every_frame: true as const,
    };
    const promise = bobine.media.frames(request);
    expect(posted[0]?.message).toMatchObject({ method: "media.frames", params: request });
    const value = {
      raw: "frames-0.raw",
      header: "frames-0.json",
      count: 25,
      width: 1920,
      height: 1080,
    };
    receive({ bobine: 1, kind: "result", id: 1, ok: true, value });
    await expect(promise).resolves.toEqual(value);
  });

  it("runs a render session with media.encode begin, append, finish and cancel", async () => {
    const { win, posted, receive } = fakeWindow();
    const bobine = createBobine(() => win);
    const begin = bobine.media.encode.begin({
      width: 3840,
      height: 2160,
      fps: { num: 25, den: 1 },
      name: "Plan 4K",
    });
    receive({ bobine: 1, kind: "result", id: 1, ok: true, value: { session: "s1" } });
    const { session } = await begin;
    const append = bobine.media.encode.append({ session, raw: "out-0.raw" });
    receive({ bobine: 1, kind: "result", id: 2, ok: true, value: { frames: 25 } });
    await expect(append).resolves.toEqual({ frames: 25 });
    const finish = bobine.media.encode.finish({ session });
    receive({ bobine: 1, kind: "result", id: 3, ok: true, value: { media: "m2" } });
    await expect(finish).resolves.toEqual({ media: "m2" });
    const cancel = bobine.media.encode.cancel({ session });
    receive({ bobine: 1, kind: "result", id: 4, ok: true, value: null });
    await expect(cancel).resolves.toBeUndefined();
    expect(posted.map((p) => [p.message.method, p.message.params])).toEqual([
      [
        "media.encode.begin",
        { width: 3840, height: 2160, fps: { num: 25, den: 1 }, name: "Plan 4K" },
      ],
      ["media.encode.append", { session: "s1", raw: "out-0.raw" }],
      ["media.encode.finish", { session: "s1" }],
      ["media.encode.cancel", { session: "s1" }],
    ]);
  });

  it("refuses every_frame with a clip and fps with every_frame at compile time", () => {
    const box = { width: 640, height: 360, format: "gray" as const };
    const ok: FramesRequest[] = [
      { ...box, clip: "c1", fps: 15 },
      { ...box, media: "m1", every_frame: true, from: 0, to: 2 },
    ];
    // @ts-expect-error every_frame only works with media
    const withClip: FramesRequest = { ...box, clip: "c1", every_frame: true };
    // @ts-expect-error fps is ignored with every_frame, so it is refused
    const withFps: FramesRequest = { ...box, media: "m1", every_frame: true, fps: 8 };
    expect([...ok, withClip, withFps]).toHaveLength(4);
  });

  it("asks both media:frames and project:write for a render, like Bobine", () => {
    expect(METHODS["media.encode.begin"]).toEqual(["media:frames", "project:write"]);
    expect(METHODS["native.call"]).toEqual(["native:worker"]);
    expect(METHODS["ui.notify"]).toEqual([]);
  });

  it("lets a plugin send ReplaceClipMedia", () => {
    const command: PluginCommand = {
      type: "ReplaceClipMedia",
      clip: "c1",
      media: "m2",
      source_in: 0,
    };
    expect(command.type).toBe("ReplaceClipMedia");
  });

  it("does not touch window before the first call", () => {
    const getWindow = vi.fn(() => fakeWindow().win);
    createBobine(getWindow);
    expect(getWindow).not.toHaveBeenCalled();
  });
});

describe("applyTheme", () => {
  it("sets color and radius tokens as CSS variables and the color scheme", () => {
    const set: Record<string, string> = {};
    const target = {
      style: {
        colorScheme: "",
        setProperty(name: string, value: string) {
          set[name] = value;
        },
      },
    };
    applyTheme(
      {
        mode: "dark",
        tokens: {
          "--color-fg": "oklch(95% 0 0)",
          "--radius-md": "8px",
          "--font-sans": "Comic Sans",
          "--color-empty": "",
        },
      },
      target,
    );
    expect(set).toEqual({ "--color-fg": "oklch(95% 0 0)", "--radius-md": "8px" });
    expect(target.style.colorScheme).toBe("dark");
  });
});
