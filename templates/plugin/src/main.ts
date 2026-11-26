// The plugin's logic. It runs in a hidden, sandboxed iframe while the plugin is on: no network,
// no access to Bobine's window, only the SDK (messages to Bobine, checked against permissions).
import { bobine } from "@bobine/plugin-sdk";

bobine.command("hello", async () => {
  const { clips, playhead } = await bobine.selection.get();
  await bobine.ui.notify(
    "info",
    `Hello! ${clips.length} clip(s) selected, playhead at ${playhead.toFixed(1)} s.`,
  );
});
