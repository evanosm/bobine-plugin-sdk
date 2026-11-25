// The panel: a page in the library, in its own sandboxed iframe. Same SDK as the logic.
import { activeSequence, applyTheme, bobine } from "bobine-plugin-sdk";

const count = document.querySelector<HTMLParagraphElement>("#count");
const hello = document.querySelector<HTMLButtonElement>("#hello");

async function refresh(): Promise<void> {
  const sequence = activeSequence(await bobine.project.get());
  const clips = sequence?.tracks.reduce((n, track) => n + track.clips.length, 0) ?? 0;
  if (count) count.textContent = sequence ? `${sequence.name}: ${clips} clip(s)` : "No sequence";
}

// Bobine's colors, in light and dark: tokens become CSS variables (--color-fg, --color-bg…).
bobine.on("theme", (theme) => applyTheme(theme));
bobine.on("project", () => void refresh());
hello?.addEventListener("click", () => void bobine.ui.notify("ok", "Hello from the panel"));

void bobine.theme.get().then((theme) => applyTheme(theme));
void refresh();
