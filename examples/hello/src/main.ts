// Logic of the Hello example: runs in a hidden, sandboxed iframe while the plugin is on.
import { bobine } from "@bobine/plugin-sdk";
import { proposeMarkers } from "./shared";

bobine.command("hello", async () => {
  const { clips, playhead } = await bobine.selection.get();
  await bobine.ui.notify(
    "info",
    `Hello! ${clips.length} clip(s) selected, playhead at ${playhead.toFixed(1)} s.`,
  );
});

bobine.command("markers", () => proposeMarkers(bobine));
