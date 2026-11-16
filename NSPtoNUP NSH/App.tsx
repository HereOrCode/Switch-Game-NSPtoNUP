// NSPtoNUP: converts NSP to NUP. The UI lives in ui/, the Rust part in src/.

import { mount, View } from "nsh";
import { DeleteSheet } from "./ui/components/DeleteSheet";
import { GameEditorSheet } from "./ui/components/GameEditorSheet";
import { Home, queueButton, selectedGameId } from "./ui/components/Home";
import { ImportSheet } from "./ui/components/ImportSheet";
import { KeysSheet } from "./ui/components/KeysSheet";
import { LogSheet } from "./ui/components/LogSheet";
import { QueueCard } from "./ui/components/QueueCard";
import { SettingsSheet } from "./ui/components/SettingsSheet";
import { applyLanguage } from "./ui/i18n";
import { env, initNative, native } from "./ui/native";
import { importNsps } from "./ui/state/actions";
import { loadLibrary } from "./ui/state/library";
import { injectMockData } from "./ui/state/mock";
import { loadSettings } from "./ui/state/settings";
import { queueOpen } from "./ui/state/ui";
import { setupSystem } from "./ui/system";

function App() {
  initNative();
  loadSettings();
  applyLanguage();
  loadLibrary();
  setupSystem(selectedGameId);
  // Demo mode: running and queued tasks plus logs of finished conversions
  if (env.mock) injectMockData();
  // Debug: NSPTONUP_ADD=<NSP or folder, multiple separated by |> adds them after launch
  const add = native.debugEnv("NSPTONUP_ADD");
  if (add) setTimeout(() => importNsps(add.split("|")), 500);
  return (
    <View style={{ flex: 1, backgroundColor: "#000000" }}>
      <Home />
      <If when={queueOpen()}>
        <QueueCard anchor={queueButton()} />
      </If>
      {/* Sheets: later ones stack on top (the keys sheet can be opened from settings) */}
      <GameEditorSheet />
      <LogSheet />
      <ImportSheet />
      <SettingsSheet />
      <KeysSheet />
      <DeleteSheet />
    </View>
  );
}

mount(App);
