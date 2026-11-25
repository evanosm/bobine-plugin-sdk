// Panel of the Hello example: a summary of the active sequence, kept up to date.
import { activeSequence, applyTheme, bobine, FLICKS_PER_SECOND } from "bobine-plugin-sdk";
import { proposeMarkers, sequenceEnd } from "./shared";

const name = document.querySelector<HTMLHeadingElement>("#name");
const stats = document.querySelector<HTMLParagraphElement>("#stats");
const markers = document.querySelector<HTMLButtonElement>("#markers");

async function refresh(): Promise<void> {
  const sequence = activeSequence(await bobine.project.get());
  if (!name || !stats) return;
  if (!sequence) {
    name.textContent = "No sequence";
    stats.textContent = "";
    return;
  }
  const clips = sequence.tracks.reduce((n, track) => n + track.clips.length, 0);
  const seconds = Math.round(sequenceEnd(sequence) / FLICKS_PER_SECOND);
  name.textContent = sequence.name;
  stats.textContent = `${clips} clip(s), ${sequence.markers.length} marker(s), ${seconds} s`;
}

bobine.on("theme", (theme) => applyTheme(theme));
bobine.on("project", () => void refresh());
markers?.addEventListener("click", () => {
  proposeMarkers(bobine).catch((error: Error) => void bobine.ui.notify("error", error.message));
});

void bobine.theme.get().then((theme) => applyTheme(theme));
void refresh();
