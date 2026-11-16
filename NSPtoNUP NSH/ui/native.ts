// Typed wrapper around the Rust part (Native in src/lib.rs): structured data is passed as JSON in both directions.

import { Native } from "nsptonup/native";
import { L, type Msg } from "./i18n";

export interface Environment {
  dataDir: string;
  coversDir: string;
  /// For display (~/…)
  workDir: string;
  defaultOutput: string;
  /// macos-arm64、windows-x64 …
  platform: string;
  /// Tool name -> path; null when not found
  tools: Record<"nxpatch" | "nup", string | null>;
  /// Demo mode (debug build, NSPTONUP_MOCK=1)
  mock: boolean;
}

export interface KeysCheck {
  keyCount: number;
  /// null means nothing is missing
  missing: string[] | null;
  unreadable: boolean;
  /// Names of malformed entries that were ignored (does not affect usage)
  ignored: string[];
}

export interface TitleKeysCheck {
  /// Entry count (one line per game)
  count: number;
  skippedLines: number;
  unreadable: boolean;
}

/// Result of nxpatch identify: base / update / dlc
export interface NspContent {
  path: string;
  kind: "base" | "update" | "dlc";
  /// 16 uppercase hex digits
  titleId: string;
  /// cnmt version: the high 16 bits are the revision (e.g. 589824 → v9)
  version: number;
  size: number;
}

export interface Identified {
  path: string;
  content: NspContent | null;
  error: Msg | null;
}

export interface FileInfo {
  exists: boolean;
  isFile: boolean;
  size: number;
}

export interface ProbeResult {
  titleId: string | null;
  name: string | null;
  publisher: string | null;
  displayVersion: string | null;
  localizedNames: Record<string, string>;
  icon: string | null;
}

export interface ConvertInput {
  nsp: string;
  /// Update (at most one) and DLC
  extras: { kind: "update" | "dlc"; nsp: string; version: number }[];
  keys: string;
  titleKeys: string | null;
  outputDirectory: string;
  previousOutput: string | null;
  name: string | null;
  publisher: string | null;
  displayVersion: string | null;
  localizedNames: Record<string, string>;
  cover: string | null;
  autoCover: boolean;
  coverDestination: string;
  cleanup: boolean;
}

export interface ConvertOutput {
  nup: string;
  nupSize: number;
  titleId: string | null;
  name: string;
  publisher: string | null;
  displayVersion: string | null;
  localizedNames: Record<string, string>;
  cover: string | null;
  coverDownloaded: boolean;
  warnings: Msg[];
}

export type ConvertResult =
  | { ok: true; output: ConvertOutput }
  | { ok: false; cancelled: boolean; error: Msg };

export type PipelineEvent =
  | { type: "stepStarted"; step: number }
  | { type: "stepFinished"; step: number; detail: Msg }
  | { type: "progress"; value: number | null }
  /// Tool output (verbatim)
  | { type: "log"; line: string }
  /// Log written by the app (translated)
  | { type: "logMsg"; msg: Msg };

/// Available after the root component calls initNative at startup (the data directory is only available while components run)
export let env: Environment;

export function initNative() {
  env = JSON.parse(Native.init(process.dataDir));
}

export const native = {
  readData: (name: string): string | null => Native.readData(name) ?? null,
  writeData: (name: string, text: string) => Native.writeData(name, text),
  checkKeys: (path: string): KeysCheck => JSON.parse(Native.checkKeys(path)),
  checkTitleKeys: (path: string): TitleKeysCheck => JSON.parse(Native.checkTitleKeys(path)),
  detectKeyFile: (path: string) => Native.detectKeyFile(path) as "prod" | "title" | "unknown",
  scan: (paths: string[]): { nsps: string[]; others: string[] } => JSON.parse(Native.scan(paths)),
  identify: async (nsps: string[], keys: string, onProgress: (done: number) => void = () => {}): Promise<Identified[]> =>
    JSON.parse(await Native.identify(nsps, keys, onProgress)),
  fileInfo: (path: string): FileInfo => JSON.parse(Native.fileInfo(path)),
  removeFile: (path: string) => Native.removeFile(path),
  moveFile: (from: string, to: string) => Native.moveFile(from, to),
  tempPath: (name: string): string => Native.tempPath(name),
  formatBytes: (bytes: number): string => Native.formatBytes(bytes),
  displayPath: (path: string): string => Native.displayPath(path),
  probe: async (nsp: string, keys: string, titleKeys: string | null, icon: string | null, allowPatch = false): Promise<ProbeResult> =>
    JSON.parse(await Native.probe(nsp, keys, titleKeys, icon, allowPatch)),
  convert: async (jobId: string, input: ConvertInput, onEvent: (event: PipelineEvent) => void): Promise<ConvertResult> =>
    JSON.parse(await Native.convert(jobId, JSON.stringify(input), (text: string) => onEvent(JSON.parse(text)))),
  cancel: (jobId: string) => Native.cancel(jobId),
  downloadCover: (titleId: string, destination: string): Promise<void> => Native.downloadCover(titleId, destination),
  saveCover: (image: string, destination: string): Promise<boolean> => Native.saveCover(image, destination),
  pickNsps: (title = L("add_panel_message")): Promise<string[]> => Native.pickNsps(title, L("add_panel_prompt")),
  pickKeys: async (title: string): Promise<string | null> => (await Native.pickKeys(title, L("action_choose"))) ?? null,
  saveText: (name: string, text: string): Promise<boolean> => Native.saveText(name, text, L("action_save")),
  trash: (path: string): Promise<void> => Native.trash(path),
  pickImage: async (): Promise<string | null> =>
    (await Native.pickImage(L("cover_panel_message"), L("cover_panel_prompt"), L("image_filter_name"))) ?? null,
  pickFolder: async (): Promise<string | null> => (await Native.pickFolder(L("output_panel_message"), L("action_choose"))) ?? null,
  reveal: (path: string): Promise<void> => Native.reveal(path),
  debugEnv: (name: string): string | null => Native.debugEnv(name) ?? null,
};

/// Dropped files arrive as file: URLs; convert them to local paths
export function pathFromUrl(uri: string): string {
  if (!uri.startsWith("file:")) return uri;
  let path = decodeURIComponent(uri.replace(/^file:\/\/(localhost)?/, ""));
  // Windows：file:///C:/…
  if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1);
  return path;
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function extension(path: string): string {
  const name = fileName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.endsWith(sep) ? dir + name : dir + sep + name;
}
