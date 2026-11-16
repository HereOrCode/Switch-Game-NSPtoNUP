// System integration: menu bar, conversion-finished notifications, conversion progress in the Dock / taskbar.

import { effect, Notifications, untracked } from "nsh";
import { currentWindow, focusedWindow, Menu, type MenuItem } from "nsh/desktop";
import { firstLine, L } from "./i18n";
import { native } from "./native";
import * as actions from "./state/actions";
import { game } from "./state/library";
import * as queue from "./state/queue";
import { notifyOnFinish } from "./state/settings";
import { editorSheet, focusGame, queueOpen, settingsOpen } from "./state/ui";

/// Called by the root component (the current window must be obtained inside a component)
export function setupSystem(selectedGameId: () => string | null) {
  const win = currentWindow();
  const mac = process.platform === "macos";

  // Menu bar (not shown on Windows / Linux when the title bar is hidden, but shortcuts still work)
  effect(() => {
    L("menu_file"); // Rebuild the menu when the language changes
    const running = queue.isRunning();
    const pending = queue.pendingGames().length;
    const selected = selectedGameId();
    const items: MenuItem[] = [];
    if (mac) {
      items.push({
        label: "NSPtoNUP",
        submenu: [
          { role: "about" },
          { type: "separator" },
          { label: L("menu_settings"), shortcut: "mod+,", onSelect: () => settingsOpen.set(true) },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "showAll" },
          { type: "separator" },
          { role: "quit" },
        ],
      });
    }
    items.push({
      label: L("menu_file"),
      submenu: [
        { label: L("action_add_ellipsis"), shortcut: "mod+o", onSelect: () => actions.addNsps() },
        { type: "separator" },
        { label: L("menu_convert_all"), shortcut: "mod+r", disabled: pending === 0, onSelect: () => actions.convertAll() },
        { label: L("menu_stop"), shortcut: "mod+.", disabled: !running, onSelect: () => actions.stopAll() },
        { type: "separator" },
        mac ? { role: "close" } : { label: L("menu_settings"), shortcut: "mod+,", onSelect: () => settingsOpen.set(true) },
        !mac && { role: "quit" },
      ].filter(Boolean) as MenuItem[],
    });
    items.push({
      label: L("menu_edit"),
      submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }],
    });
    items.push({
      label: L("menu_view"),
      submenu: [
        {
          label: L("menu_edit_info"),
          shortcut: "mod+alt+i",
          disabled: !selected,
          onSelect: () => selected && editorSheet.set({ mode: "edit", id: selected }),
        },
        { label: L("queue_title"), shortcut: "mod+j", onSelect: () => queueOpen.set(!untracked(queueOpen)) },
      ],
    });
    items.push({ label: L("menu_window"), submenu: [{ role: "minimize" }, { role: "zoom" }] });
    Menu.setApplicationMenu(items);
  });

  // Dock / taskbar: show overall progress while converting
  effect(() => {
    const running = queue.isRunning();
    win.set({ progress: running ? { value: queue.batchProgress(), state: "normal" } : null });
  });

  // Request notification permission only when the first conversion starts, to avoid a prompt as soon as the app opens
  let asked = false;
  effect(() => {
    if (!queue.isRunning() || asked || !untracked(notifyOnFinish)) return;
    asked = true;
    Notifications.requestPermission().catch(() => {});
  });

  // Task finished: system notification; while the app is in the background, the Dock badge shows the finished count
  let unseen = 0;
  effect(() => {
    const job = queue.finishedJob();
    if (!job) return;
    untracked(() => {
      const g = game(job.gameId);
      if (!g) return;
      const state = job.state();
      if (state === "finished" || state === "failed") {
        if (!focusedWindow()) Notifications.setBadge(++unseen);
        if (notifyOnFinish()) {
          Notifications.show({
            id: job.gameId,
            title: state === "finished" ? L("notification_done_title") : L("notification_failed_title"),
            body: state === "finished" ? L("notification_done_body", g.name) : L("notification_failed_body", g.name, firstLine(job.error())),
          }).catch(() => {});
        }
      }
    });
  });
  effect(() => {
    if (focusedWindow() && unseen) {
      unseen = 0;
      Notifications.setBadge(0);
    }
  });

  // Notification clicked: select this game and reveal the generated NUP in Finder
  Notifications.on("press", ({ id }: { id: string }) => {
    const g = game(id);
    if (!g) return;
    win.focus();
    focusGame.set(id);
    if (g.nupPath) native.reveal(g.nupPath).catch(() => {});
  });
}
