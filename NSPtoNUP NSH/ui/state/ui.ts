// Shared UI-layer state: which sheets are open. Sheets attach to the main window, and only one is open at a time.

import { signal } from "nsh";
import type { NspContent } from "../native";
import type { Skip } from "./library";

/// Game info sheet: edits an existing game or adds games (items are base games with the updates / DLC added alongside; several are confirmed one by one)
export type EditorRequest =
  | { mode: "edit"; id: string; addContent?: boolean }
  | {
      mode: "add";
      items: { nsp: string; extras: NspContent[] }[];
      /// Update display versions (by NSP path)
      versions: Record<string, string>;
      /// Called once everything is handled (added, skipped or all cancelled)
      onDone?: () => void;
    };

export const editorSheet = signal<EditorRequest | null>(null);
/// Conversion log sheet: game id
export const logSheet = signal<string | null>(null);
/// Identification and summary list sheet: NSPs to identify; sourceName is the name of the single chosen folder
export const importSheet = signal<{ nsps: string[]; sourceName: string | null; others: Skip[] } | null>(null);
/// Keys sheet
export const keysSheetOpen = signal(false);
/// Settings sheet
export const settingsOpen = signal(false);
/// Delete-game confirmation sheet
export const deleteSheet = signal<{ id: string; preselectFiles: boolean } | null>(null);
/// Floating conversion queue card
export const queueOpen = signal(false);
/// Requests the home screen to select a game (clicking a row in the queue card, notifications)
export const focusGame = signal<string | null>(null, { equals: false });

/// Whether any sheet is open (home screen keyboard actions are disabled meanwhile)
export const sheetOpen = () =>
  !!editorSheet() || !!logSheet() || !!importSheet() || keysSheetOpen() || settingsOpen() || !!deleteSheet();
