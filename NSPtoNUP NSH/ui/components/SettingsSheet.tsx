// Settings (⌘,): a sheet attached to the main window, using system-style controls.
// A segmented control at the top switches "General / Keys / Covers / Tools"; below are grouped rows with "title and description on the left, control on the right".

import { signal, Text, View } from "nsh";
import { Menu } from "nsh/desktop";
import { L, LANGUAGE_OPTIONS, languagePreference, Lc } from "../i18n";
import { env, native } from "../native";
import { fileManagerName } from "../state/actions";
import {
  autoCover,
  categoryShortcuts,
  cleanupWorkDir,
  keysCheck,
  keysPath,
  notifyOnFinish,
  outputDirectory,
  outputPath,
  titleKeysCheck,
  titleKeysPath,
} from "../state/settings";
import { keysSheetOpen, settingsOpen } from "../state/ui";
import { Button, Group, GroupRow, Segmented, Separator, Sheet, SheetButtons, SheetTitle, Status, SYS, Switch, type StatusInfo } from "./sys";

const PANES = () => [L("settings_tab_general"), L("settings_tab_keys"), L("settings_tab_cover"), L("settings_tab_tools")];
/// Last opened category (remembered for this run)
const lastPane = signal(0);

export function SettingsSheet() {
  const close = () => settingsOpen.set(false);
  return (
    <Sheet open={settingsOpen()} onCancel={close} width={640} height={460} label={L("settings_title")}>
      <If when={settingsOpen()}>
        <View style={{ flex: 1 }}>
          <SheetTitle title={L("settings_title")} />
          <Separator />
          <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 14, gap: 14 }}>
            <Segmented items={PANES()} selected={lastPane()} onChange={lastPane.set} />
            {lastPane() === 0 ? <GeneralPane /> : lastPane() === 1 ? <KeysPane /> : lastPane() === 2 ? <CoverPane /> : <ToolsPane />}
          </View>
          <Separator />
          <SheetButtons>
            <View style={{ flex: 1 }} />
            <Button title={L("action_done")} primary onPress={close} testID="settings-done" />
          </SheetButtons>
        </View>
      </If>
    </Sheet>
  );
}

function Footnote(props: { text: string }) {
  return <Text style={{ color: SYS.secondary, fontSize: 11, paddingHorizontal: 4 }}>{props.text}</Text>;
}

function GeneralPane() {
  const changeOutput = async () => {
    const folder = await native.pickFolder();
    if (folder) outputPath.set(folder);
  };
  const shortcutKeys = process.platform === "macos" ? "⌘1–⌘4" : "Ctrl+1–Ctrl+4";
  const languageName = () => LANGUAGE_OPTIONS.find((o) => o.id === languagePreference())!.name();
  // Applies immediately after selection, no restart needed
  const chooseLanguage = () =>
    Menu.popup(
      LANGUAGE_OPTIONS.flatMap((option, i) => [
        ...(i === 1 ? [{ type: "separator" as const }] : []),
        { label: option.name(), checked: languagePreference() === option.id, onSelect: () => languagePreference.set(option.id) },
      ]),
    );
  return (
    <Group>
      <GroupRow first title={L("settings_language")} note={L("settings_language_note")}>
        <Button title={languageName()} trailingIcon="chevrons-up-down" onPress={chooseLanguage} testID="language-button" />
      </GroupRow>
      <GroupRow title={L("settings_output")} note={native.displayPath(outputDirectory())}>
        <Button title={L("action_change")} onPress={changeOutput} />
      </GroupRow>
      <GroupRow title={L("settings_notify")} note={L("settings_notify_note_in", fileManagerName())}>
        <Switch on={notifyOnFinish()} onChange={notifyOnFinish.set} label={L("settings_notify")} />
      </GroupRow>
      <GroupRow title={L("settings_cleanup")} note={L("settings_cleanup_note", env.workDir)}>
        <Switch on={cleanupWorkDir()} onChange={cleanupWorkDir.set} label={L("settings_cleanup")} />
      </GroupRow>
      <GroupRow title={L("settings_shortcuts")} note={L("settings_shortcuts_note_keys", shortcutKeys)}>
        <Switch on={categoryShortcuts()} onChange={categoryShortcuts.set} label={L("settings_shortcuts")} testID="shortcuts-switch" />
      </GroupRow>
    </Group>
  );
}

function KeysPane() {
  const prodStatus = (): StatusInfo => {
    const check = keysCheck();
    if (!check) return { text: L("settings_not_configured"), icon: "triangle-alert", color: SYS.orange };
    if (check.unreadable) return { text: L("home_status_unreadable"), icon: "circle-x", color: SYS.red };
    if (check.missing) return { text: L("settings_keys_incomplete"), icon: "circle-x", color: SYS.red };
    return { text: Lc("settings_key_count", check.keyCount), icon: "circle-check", color: SYS.green };
  };
  const titleStatus = (): StatusInfo => {
    const check = titleKeysCheck();
    if (!check) return { text: L("settings_not_added"), icon: "circle-dashed", color: SYS.tertiary };
    if (check.unreadable || !check.count) return { text: L("home_status_unreadable"), icon: "circle-x", color: SYS.red };
    return { text: Lc("count_games", check.count), icon: "circle-check", color: SYS.green };
  };
  return (
    <>
      <Group>
        <GroupRow first title="prod.keys" note={keysPath() ? native.displayPath(keysPath()!) : L("settings_not_added_yet")}>
          <Status status={prodStatus()} />
          <Button title={keysPath() ? L("action_change") : L("action_add_ellipsis")} onPress={() => keysSheetOpen.set(true)} />
        </GroupRow>
        <GroupRow title={L("settings_title_keys")} note={titleKeysPath() ? native.displayPath(titleKeysPath()!) : L("settings_title_keys_note")}>
          <Status status={titleStatus()} />
          <Button title={titleKeysPath() ? L("action_change") : L("action_add_ellipsis")} onPress={() => keysSheetOpen.set(true)} />
        </GroupRow>
      </Group>
      <Footnote text={L("settings_keys_footnote")} />
    </>
  );
}

function CoverPane() {
  return (
    <Group>
      <GroupRow
        first
        title={L("settings_auto_cover")}
        note={L("settings_auto_cover_note")}
      >
        <Switch on={autoCover()} onChange={autoCover.set} label={L("settings_auto_cover")} />
      </GroupRow>
    </Group>
  );
}

function ToolsPane() {
  const tools = [
    { name: "nup" as const, note: () => L("settings_tool_nup") },
    { name: "nxpatch" as const, note: () => L("settings_tool_nxpatch") },
  ];
  return (
    <>
      <Group>
        {tools.map((tool, i) => (
          <GroupRow first={i === 0} title={tool.name} note={tool.note()}>
            <Status
              status={
                env.tools[tool.name]
                  ? { text: L("settings_tool_bundled"), icon: "circle-check", color: SYS.green }
                  : { text: L("settings_tool_missing"), icon: "circle-x", color: SYS.red }
              }
            />
          </GroupRow>
        ))}
      </Group>
      <Footnote text={L("settings_platform", env.platform)} />
    </>
  );
}
