import {
  activeSequence,
  type Bobine,
  FLICKS_PER_SECOND,
  type MarkerColor,
  type PluginCommand,
  type Sequence,
} from "@bobine/plugin-sdk";

/** End of the last clip of the sequence, in flicks. */
export function sequenceEnd(sequence: Sequence): number {
  let end = 0;
  for (const track of sequence.tracks) {
    for (const clip of track.clips) end = Math.max(end, clip.timeline_start + clip.duration);
  }
  return end;
}

/** One `AddMarker` command every `every` seconds, from `every` to the end of the sequence. */
export function regularMarkers(
  sequence: Sequence,
  every: number,
  color: MarkerColor,
  idPrefix: string,
): PluginCommand[] {
  const step = Math.round(every * FLICKS_PER_SECOND);
  const end = sequenceEnd(sequence);
  const commands: PluginCommand[] = [];
  for (let time = step, n = 1; time < end && commands.length < 500; time += step, n += 1) {
    commands.push({
      type: "AddMarker",
      marker: { id: `${idPrefix}-${n}`, time, duration: 0, label: `${n}`, color, resolved: false },
    });
  }
  return commands;
}

/** Proposes the markers on the timeline: the user applies or cancels them. */
export async function proposeMarkers(bobine: Bobine): Promise<void> {
  const [project, settings] = await Promise.all([
    bobine.project.get(),
    bobine.settings.get<{ every: number; color: MarkerColor }>(),
  ]);
  const sequence = activeSequence(project);
  if (!sequence) {
    await bobine.ui.notify("error", "Open a sequence first.");
    return;
  }
  const commands = regularMarkers(
    sequence,
    settings.every,
    settings.color,
    `hello-${Date.now().toString(36)}`,
  );
  if (commands.length === 0) {
    await bobine.ui.notify("info", "The sequence is shorter than the marker interval.");
    return;
  }
  await bobine.project.propose({ label: `${commands.length} regular markers`, commands });
}
