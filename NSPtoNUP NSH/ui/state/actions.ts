// Actions shared by the home screen, queue and menus. Actions needing confirmation use system alerts.

import { AlertDialog } from "nsh/base";
import { Menu, type MenuItem } from "nsh/desktop";
import { errorMsg, L, Lc, msg, raw, text, withDetail, type Msg } from "../i18n";
import { fileName, native } from "../native";
import { SCAN_LIMIT } from "./importPlan";
import { contentsChanged, game, nspExists, nupExists, type Game, type Skip } from "./library";
import * as queue from "./queue";
import { itemState } from "./itemState";
import { keysPath, refreshKeys, titleKeysPath, validKeysPath } from "./settings";
import { deleteSheet, editorSheet, importSheet, keysSheetOpen, logSheet } from "./ui";

export async function showError(message: Msg | string, title = L("error_generic_title")) {
  await AlertDialog.show({ title, description: text(message), actions: [{ id: "ok", label: L("action_ok") }], closeOnEscape: true });
}

/// Confirmation alert for destructive actions (HIG): the title is a short question, the item name goes in the body;
/// "Cancel" plus a red destructive button; Return does not trigger the destructive button; Esc cancels
export async function confirm(title: string, message: string, action: string): Promise<boolean> {
  const { action: chosen } = await AlertDialog.show({
    title,
    description: message,
    actions: [
      { id: "cancel", label: L("action_cancel"), role: "cancel" },
      { id: "confirm", label: action, role: "destructive" },
    ],
    closeOnEscape: true,
  });
  return chosen === "confirm";
}

// MARK: - Adding

export async function addNsps() {
  const paths = await native.pickNsps();
  if (paths.length) importNsps(paths);
}

export function reportSkipped(skipped: Skip[]) {
  if (!skipped.length) return;
  const lines = skipped.slice(0, 20).map(([path, reason]) => L("contents_skip_line", fileName(path), reason));
  showError(lines.join("\n") + (skipped.length > 20 ? "\n…" : ""), Lc("skipped_files_title", skipped.length));
}

/// Adds files or folders: identifies base games, updates and DLC and groups them by game.
/// With a single new game, the "Add Game" sheet confirms its info; with several, a summary list is shown and the checked ones are added at once
export function importNsps(paths: string[]) {
  if (editorSheet() || importSheet()) return;
  const { nsps, others } = native.scan(paths);
  const otherSkips: Skip[] = others.map((p) => [p, msg("skip_not_nsp")]);
  if (!nsps.length) {
    if (otherSkips.length) reportSkipped(otherSkips);
    else showError(L("error_no_nsp_found_message"), L("error_no_nsp_found_title"));
    return;
  }
  if (nsps.length > SCAN_LIMIT) {
    showError(L("error_too_many_nsps", nsps.length, SCAN_LIMIT), L("error_too_many_nsps_title"));
    return;
  }
  // Contents can't be identified without prod.keys: add each as a base game and read the info once keys are set up
  if (!validKeysPath()) {
    const { accepted, skipped } = queue.checkNsps(nsps);
    if (!accepted.length) return reportSkipped([...skipped, ...otherSkips]);
    editorSheet.set({
      mode: "add",
      items: accepted.map((nsp) => ({ nsp, extras: [] })),
      versions: {},
      onDone: () => reportSkipped([...skipped, ...otherSkips]),
    });
    return;
  }
  const single = paths.length === 1 && native.fileInfo(paths[0]).exists && !native.fileInfo(paths[0]).isFile;
  importSheet.set({ nsps, sourceName: single ? fileName(paths[0]) : null, others: otherSkips });
}

// MARK: - Keys

/// A dropped or chosen .keys file: detected as prod.keys or title.keys by its contents
export async function useKeys(path: string): Promise<boolean> {
  switch (native.detectKeyFile(path)) {
    case "title":
      titleKeysPath.set(path);
      refreshKeys();
      // Games whose info couldn't be read for lack of a title key can now be read again
      queue.loadMissingMetadata();
      return true;
    case "prod": {
      const check = native.checkKeys(path);
      if (check.unreadable) {
        await showError(L("keys_problem_unreadable"), L("error_keys_unusable_title"));
        return false;
      }
      if (check.missing) await showError(L("error_keys_missing_names", check.missing.join(", ")), L("error_keys_incomplete_title"));
      keysPath.set(path);
      refreshKeys();
      if (!check.missing) queue.loadMissingMetadata();
      return true;
    }
    default:
      await showError(L("error_keys_file_unrecognized"), L("error_unrecognized_title"));
      return false;
  }
}

/// Checks prod.keys; opens the keys sheet when missing
export function requireKeys(): boolean {
  if (validKeysPath()) return true;
  keysSheetOpen.set(true);
  return false;
}

// MARK: - Conversion

export function convert(g: Game) {
  if (!requireKeys()) return;
  if (!nspExists(g)) {
    showError(L("error_nsp_missing_multiline", g.nspPath));
    return;
  }
  queue.enqueue([g.id]);
}

export function convertAll() {
  if (requireKeys()) queue.enqueueAll();
}

/// Reveals the NUP in Finder; if the file was moved or deleted, explains why and offers to convert again
export async function revealNup(g: Game) {
  if (g.nupPath && nupExists(g)) {
    await native.reveal(g.nupPath).catch((e) => showError(errorMsg(e)));
    return;
  }
  const { action } = await AlertDialog.show({
    title: L("nup_missing_title", g.name),
    description: L("nup_missing_message", g.nupPath ?? "—"),
    actions: [
      { id: "cancel", label: L("action_cancel"), role: "cancel" },
      { id: "convert", label: L("action_reconvert") },
    ],
    closeOnEscape: true,
  });
  if (action === "convert") convert(g);
}

export function revealNsp(g: Game) {
  native.reveal(g.nspPath).catch((e) => showError(errorMsg(e)));
}

export async function chooseCover(g: Game) {
  const image = await native.pickImage();
  if (image) await setCover(g, image);
}

export async function setCover(g: Game, image: string) {
  try {
    await queue.setCover(g.id, image);
  } catch (error) {
    showError(errorMsg(error), L("error_image_unusable_title"));
  }
}

export async function redownloadCover(g: Game) {
  const failure = await queue.downloadCover(g.id);
  if (failure) showError(L("error_cover_download_choose_hint", failure), L("error_cover_download_title"));
}

/// Deletes a game: opens the confirmation sheet (optionally also moving the NSP and NUP to the Trash)
export function deleteGame(g: Game, preselectFiles = false) {
  deleteSheet.set({ id: g.id, preselectFiles });
}

/// Stops a conversion: a running one needs confirmation (progress is lost); a queued one is removed from the queue directly (it can be re-added anytime)
export async function cancelConversion(g: Game) {
  if (itemState(g).kind !== "converting") return queue.cancel(g.id);
  if (await confirm(L("confirm_stop_title"), L("confirm_stop_message", g.name), L("action_stop_conversion"))) {
    queue.cancel(g.id);
  }
}

export async function stopAll() {
  if (!queue.isRunning()) return;
  const running = queue.currentJob();
  const runningGame = running && game(running.gameId);
  const waiting = queue.waitingJobs().length;
  const parts: string[] = [];
  if (runningGame) parts.push(L("confirm_stop_all_running", runningGame.name));
  if (waiting > 0) parts.push(Lc("confirm_stop_all_waiting", waiting));
  if (await confirm(L("confirm_stop_all_title"), parts.join(L("sentence_join")), L("action_stop_all"))) queue.stopAll();
}

/// Converts again: the existing NUP is overwritten, so confirmation is needed
export async function reconvert(g: Game) {
  if (!g.nupPath || !nupExists(g)) return convert(g);
  if (await confirm(L("confirm_reconvert_title"), L("confirm_reconvert_message", g.name), L("action_reconvert"))) convert(g);
}

export async function removeCover(g: Game) {
  if (await confirm(L("confirm_remove_cover_title"), L("confirm_remove_cover_message", g.name), L("action_remove_cover"))) {
    queue.removeCover(g.id);
  }
}

/// Primary action (primary button, Return)
export function primaryAction(g: Game) {
  switch (itemState(g).kind) {
    case "pending":
    case "failed":
      return convert(g);
    case "queued":
    case "converting":
      return cancelConversion(g);
    // "Show in Finder" when the NUP exists and the contents haven't changed; otherwise convert again
    case "done":
      if (contentsChanged(g)) return reconvert(g);
      return nupExists(g) ? revealNup(g) : convert(g);
    case "unreadable":
      return deleteGame(g);
  }
}

export const showDetails = (g: Game) => editorSheet.set({ mode: "edit", id: g.id });
export const addContents = (g: Game) => editorSheet.set({ mode: "edit", id: g.id, addContent: true });

/// More-actions menu (right-click, ⋯ button)
export function showMenu(g: Game, at?: { x: number; y: number }) {
  const state = itemState(g);
  const items: MenuItem[] = [];
  if (state.kind === "queued" || state.kind === "converting") {
    items.push({ label: state.kind === "converting" ? L("menu_stop_conversion") : L("menu_remove_from_queue"), onSelect: () => cancelConversion(g) });
  } else if (state.kind === "done") {
    items.push({ label: L("menu_reconvert"), onSelect: () => reconvert(g) });
  } else if (state.kind === "reading" || state.kind === "unreadable") {
    items.push({ label: L("menu_convert"), disabled: true });
  } else {
    items.push({ label: L("menu_convert"), onSelect: () => convert(g) });
  }
  items.push({ label: L("menu_show_details"), onSelect: () => showDetails(g) });
  items.push({ label: L("menu_add_contents"), disabled: queue.isBusy(g.id), onSelect: () => addContents(g) });
  items.push({ label: L("menu_show_log"), disabled: !queue.latestJob(g.id), onSelect: () => logSheet.set(g.id) });
  items.push({ type: "separator" });
  items.push({ label: revealLabel("NUP"), disabled: !nupExists(g), onSelect: () => revealNup(g) });
  items.push({ label: revealLabel("NSP"), disabled: !nspExists(g), onSelect: () => revealNsp(g) });
  items.push({ type: "separator" });
  items.push({ label: L("menu_choose_cover"), onSelect: () => chooseCover(g) });
  items.push({ label: L("menu_redownload_cover"), disabled: !g.titleId, onSelect: () => redownloadCover(g) });
  if (!g.metadataLoaded) {
    items.push({ label: L("menu_reload_info"), disabled: !validKeysPath(), onSelect: () => queue.loadMetadata(g.id) });
  }
  items.push({ type: "separator" });
  items.push({ label: L("menu_delete_game"), disabled: state.kind === "converting", onSelect: () => deleteGame(g) });
  return Menu.popup(items, at);
}

/// File manager name: Finder on macOS, File Explorer on Windows, file manager on Linux
export function fileManagerName(): string {
  switch (process.platform) {
    case "macos":
      return L("file_manager_finder");
    case "windows":
      return L("file_manager_explorer");
    default:
      return L("file_manager_other");
  }
}

/// "Show in Finder", "Show NUP in Finder"
export const revealLabel = (what = "") => (what ? L("reveal_item_in", fileManagerName(), what) : L("reveal_in", fileManagerName()));
/// Trash: called the Recycle Bin on Windows
export const trashName = () => (process.platform === "windows" ? L("trash_name_recycle_bin") : L("trash_name_trash"));
