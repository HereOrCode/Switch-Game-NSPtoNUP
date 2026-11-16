// Game library: saved as library.json in the data directory.

import { batch, signal } from "nsh";
import { text, type Msg } from "../i18n";
import { env, joinPath, native } from "../native";

export type GameStatus = "notConverted" | "converted" | "failed";
export type CoverSource = "downloaded" | "manual";

export interface Game {
  id: string;
  nspPath: string;
  fileSize: number;
  /// ISO 8601
  addedAt: string;

  titleId?: string | null;
  name: string;
  publisher?: string | null;
  displayVersion?: string | null;
  localizedNames: Record<string, string>;
  /// nacp info has been read from the NSP
  metadataLoaded: boolean;
  /// Plain text (older data); new reasons are stored in metadataErrorMessage and follow the UI language
  metadataError?: string | null;
  metadataErrorMessage?: Msg | null;

  /// Covers and icons both live in the covers directory; file names change on every replacement so the image cache never shows a stale image
  coverFile?: string | null;
  coverSource?: CoverSource | null;
  /// Automatic download has failed before; don't retry (except for manual re-download)
  coverLookupFailed: boolean;
  iconFile?: string | null;

  status: GameStatus;
  nupPath?: string | null;
  /// Size of the generated NUP (recorded when conversion finishes)
  nupSize?: number | null;
  convertedAt?: string | null;
  /// Same as above: lastError and warnings are plain text; lastErrorMessage and warningMessages are Msg
  lastError?: string | null;
  warnings: string[];
  lastErrorMessage?: Msg | null;
  warningMessages?: Msg[] | null;

  // The fields below were added later; old data without these keys still loads fine
  /// Attached update and DLC (at most one update; DLC sorted by Title ID)
  attached?: AttachedContent[] | null;
  /// Update and DLC included in the last conversion (NSP paths)
  convertedContentPaths?: string[] | null;
}

/// An update or DLC attached to a game
export interface AttachedContent {
  kind: "update" | "dlc";
  nspPath: string;
  titleId: string;
  /// cnmt version (the update's directory name in the NUP)
  version: number;
  /// The update's display version (from the update's nacp), e.g. 1.0.137848
  displayVersion?: string | null;
  fileSize: number;
}

export const contents = (g: Game): AttachedContent[] => g.attached ?? [];
export const updateOf = (g: Game) => contents(g).find((c) => c.kind === "update");
export const dlcsOf = (g: Game) => contents(g).filter((c) => c.kind === "dlc");
/// All NSP paths of the base game and attached content
export const allNspPaths = (g: Game) => [g.nspPath, ...contents(g).map((c) => c.nspPath)];
/// Total size of the base game and attached content
export const totalSize = (g: Game) => g.fileSize + contents(g).reduce((sum, c) => sum + c.fileSize, 0);

/// A skipped file and the reason
export type Skip = [path: string, reason: Msg];

/// Why info couldn't be read, why conversion failed, and warnings: prefer the translatable Msg, then text from old data
export const metadataProblem = (g: Game): Msg | string | null => g.metadataErrorMessage ?? g.metadataError ?? null;
export const failureReason = (g: Game): Msg | string | null => g.lastErrorMessage ?? g.lastError ?? null;
export const gameWarnings = (g: Game): (Msg | string)[] => g.warningMessages ?? g.warnings;

/// A reason written to the game library: stores both the Msg and the current-language text (for readers of plain text)
export const metadataErrorFields = (reason: Msg | null) => ({ metadataErrorMessage: reason, metadataError: reason && text(reason) });
export const lastErrorFields = (reason: Msg | null) => ({ lastErrorMessage: reason, lastError: reason && text(reason) });
export const warningFields = (list: Msg[]) => ({ warningMessages: list, warnings: list.map((w) => text(w)) });

/// Description shown in lists: the display version for updates, the Title ID for DLC
export function contentLabel(c: AttachedContent): string {
  return c.kind === "update" ? (c.displayVersion ? `v${c.displayVersion}` : text({ key: "content_revision", args: [c.version >>> 16] })) : c.titleId;
}

/// Sorted attached content: update first, then DLC by Title ID
export function sortContents(list: AttachedContent[]): AttachedContent[] {
  const order = (c: AttachedContent) => (c.kind === "update" ? 0 : 1);
  return [...list].sort((a, b) => order(a) - order(b) || (a.titleId < b.titleId ? -1 : a.titleId > b.titleId ? 1 : 0));
}

/// An update / DLC was added or removed after conversion: the NUP is outdated and needs converting again
export function contentsChanged(g: Game): boolean {
  if (g.status !== "converted") return false;
  const now = new Set(contents(g).map((c) => c.nspPath));
  const then = new Set(g.convertedContentPaths ?? []);
  return now.size !== then.size || [...now].some((p) => !then.has(p));
}

function load(): Game[] {
  try {
    const games = JSON.parse(native.readData("library.json") ?? "[]") as Game[];
    return games.map((g) => ({ ...g, localizedNames: g.localizedNames ?? {}, warnings: g.warnings ?? [], coverLookupFailed: g.coverLookupFailed ?? false }));
  } catch {
    return [];
  }
}

export const games = signal<Game[]>([]);

/// Called by the app's root component after initNative
export const loadLibrary = () => games.set(load());

function save(list: Game[]) {
  native.writeData("library.json", JSON.stringify(list, null, 2));
}

export function game(id: string | null | undefined): Game | undefined {
  return id ? games().find((g) => g.id === id) : undefined;
}

export function containsNsp(path: string): boolean {
  return games().some((g) => allNspPaths(g).includes(path));
}

export function gameByBaseTitleId(titleId: string): Game | undefined {
  return games().find((g) => g.titleId?.toUpperCase() === titleId.toUpperCase());
}

export function addGame(value: Game) {
  const list = [...games(), value];
  games.set(list);
  save(list);
}

export function updateGame(id: string, change: (game: Game) => Partial<Game>) {
  const list = games().map((g) => (g.id === id ? { ...g, ...change(g) } : g));
  games.set(list);
  save(list);
}

export function removeGame(id: string) {
  const value = game(id);
  if (!value) return;
  for (const file of [value.coverFile, value.iconFile]) {
    if (file) native.removeFile(coverPath(file));
  }
  batch(() => {
    const list = games().filter((g) => g.id !== id);
    games.set(list);
    save(list);
  });
}

export const coverPath = (file: string) => joinPath(env.coversDir, file);
export const coverUrl = (g: Game | undefined) => (g?.coverFile ? coverPath(g.coverFile) : null);
export const iconUrl = (g: Game | undefined) => (g?.iconFile ? coverPath(g.iconFile) : null);

/// File name for a new cover / icon: has a random suffix so the old image isn't reused from cache after replacement
export function newImageName(id: string, kind: "cover" | "icon"): string {
  return `${id}-${kind}-${Math.random().toString(36).slice(2, 8)}.jpg`;
}

export function uuid(): string {
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  const part = (n: number) => Array.from({ length: n }, hex).join("");
  return `${part(8)}-${part(4)}-4${part(3)}-${"89ab"[Math.floor(Math.random() * 4)]}${part(3)}-${part(12)}`.toUpperCase();
}

export const nspExists = (g: Game) => native.fileInfo(g.nspPath).exists;
export const nupExists = (g: Game) => !!g.nupPath && native.fileInfo(g.nupPath).exists;
