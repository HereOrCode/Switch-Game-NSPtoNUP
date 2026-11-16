// Derives each game's state: every state maps to one label and one primary action.

import { L, type Msg } from "../i18n";
import { failureReason, gameWarnings, metadataProblem, type Game } from "./library";
import { isBusy, jobFor, reading } from "./queue";

export type ItemState =
  | { kind: "reading" }
  | { kind: "unreadable"; reason: Msg | string }
  | { kind: "pending"; missingCover: boolean }
  | { kind: "queued" }
  | { kind: "converting"; step: number | null; progress: number }
  | { kind: "done"; outputBytes: number | null; warning: Msg | string | null }
  /// reason may span several lines (title + details); usually only the first line is shown
  | { kind: "failed"; reason: Msg | string };

export function itemState(game: Game): ItemState {
  const job = jobFor(game.id);
  if (job) {
    return job.state() === "running"
      ? { kind: "converting", step: job.currentStep(), progress: job.overallProgress() }
      : { kind: "queued" };
  }
  const problem = metadataProblem(game);
  if (problem && !reading().has(game.id)) return { kind: "unreadable", reason: problem };
  if (!game.metadataLoaded) return { kind: "reading" };
  switch (game.status) {
    case "converted":
      return { kind: "done", outputBytes: game.nupSize && game.nupSize > 0 ? game.nupSize : null, warning: gameWarnings(game)[0] ?? null };
    case "failed":
      return { kind: "failed", reason: failureReason(game) ?? { key: "error_unknown" } };
    default:
      return { kind: "pending", missingCover: !game.coverFile };
  }
}

export type Category = "all" | "done" | "failed" | "converting";

export const CATEGORIES: { id: Category; title: () => string; icon: string }[] = [
  { id: "all", title: () => L("category_all"), icon: "layout-grid" },
  { id: "done", title: () => L("category_done"), icon: "circle-check" },
  { id: "failed", title: () => L("category_failed"), icon: "triangle-alert" },
  { id: "converting", title: () => L("category_converting"), icon: "clock" },
];

/// Games in the queue (converting or waiting) appear only under "Converting" and no longer count as finished or failed
export function matches(category: Category, game: Game): boolean {
  const busy = isBusy(game.id);
  switch (category) {
    case "all":
      return true;
    case "done":
      return !busy && game.status === "converted";
    case "failed":
      return !busy && (game.status === "failed" || !!metadataProblem(game));
    case "converting":
      return busy;
  }
}
