// The five NSP → NUP steps (indices match Step in src/pipeline.rs). nxpatch reads the NSP directly, with no unpacking first.

import { L } from "../i18n";

export interface StepInfo {
  title: () => string;
  /// Short name used by the log page and queue
  shortTitle: () => string;
  /// Share of overall progress (based on measured times: extraction and packing both read and write the whole game, packing is followed by verification, other steps are fast)
  weight: number;
  /// Large step that reads and writes the whole game: simulated progress is estimated from the game size
  bulk: boolean;
}

export const STEPS: StepInfo[] = [
  { title: () => L("step_identify"), shortTitle: () => L("step_identify_short"), weight: 0.01, bulk: false },
  { title: () => L("step_extract"), shortTitle: () => L("step_extract_short"), weight: 0.42, bulk: true },
  { title: () => L("step_metadata"), shortTitle: () => L("step_metadata_short"), weight: 0.01, bulk: false },
  { title: () => L("step_cover"), shortTitle: () => L("step_cover_short"), weight: 0.02, bulk: false },
  { title: () => L("step_pack"), shortTitle: () => L("step_pack_short"), weight: 0.54, bulk: true },
];

/// Time constant (seconds) of simulated progress when there's no real progress
export function simulatedDuration(step: number, fileSize: number): number {
  // Estimate the time to read and write the whole game at about 150 MB/s
  if (STEPS[step].bulk) return Math.max(fileSize / 150_000_000, 5);
  return step === 3 ? 3 : 2;
}
