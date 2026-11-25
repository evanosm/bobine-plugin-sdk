import { describe, expect, it, vi } from "vitest";
import { BobineError, createBobine, type PluginWindow } from "../src/client";
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
