// Keys sheet: prod.keys (required) and title.keys (optional).
// Explanation on top, drop zone or "Choose File…", live validation, "Done" saves, Cancel changes nothing.
// Dropped files are sorted into the matching slot by content.

import { signal, Text, untracked, View } from "nsh";
import { L, Lc } from "../i18n";
import { fileName, native, pathFromUrl } from "../native";
import { confirm } from "../state/actions";
import * as queue from "../state/queue";
import { ignoredKeysMessage, keysPath, refreshKeys, titleKeysPath } from "../state/settings";
import { keysSheetOpen } from "../state/ui";
import { Button, Sheet, Status, SYS, SysIcon, type StatusInfo } from "./sys";

export function KeysSheet() {
  const close = () => keysSheetOpen.set(false);
  return (
    <Sheet open={keysSheetOpen()} onCancel={close} width={620} label={L("settings_tab_keys")}>
      <If when={keysSheetOpen()}>
        <KeysContent onClose={close} />
      </If>
    </Sheet>
  );
}

function KeysContent(props: { onClose: () => void }) {
  /// Files chosen but not yet saved
  const prod = signal<string | null>(untracked(keysPath));
  const title = signal<string | null>(untracked(titleKeysPath));

  const prodCheck = () => (prod() ? native.checkKeys(prod()!) : null);
  const prodValid = () => {
    const c = prodCheck();
    return !!c && !c.unreadable && !c.missing && native.detectKeyFile(prod()!) !== "title";
  };
  const prodStatus = (): StatusInfo => {
    const path = prod();
    if (!path) return { text: L("keys_validation_none"), icon: "circle-dashed", color: SYS.tertiary };
    if (native.detectKeyFile(path) === "title") return { text: L("keys_validation_is_title_keys"), icon: "circle-x", color: SYS.red };
    const c = prodCheck()!;
    if (c.unreadable) return { text: L("keys_validation_not_prod"), icon: "circle-x", color: SYS.red };
    if (c.missing) return { text: L("keys_problem_missing", c.missing.join(", ")), icon: "circle-x", color: SYS.red };
    const ignored = c.ignored.length ? Lc("keys_validation_ignored", c.ignored.length) : "";
    return { text: L("keys_validation_valid", Lc("settings_key_count", c.keyCount)) + ignored, icon: "circle-check", color: SYS.green };
  };
  const titleStatus = (): StatusInfo => {
    const path = title();
    if (!path) return { text: L("settings_not_added"), icon: "circle-dashed", color: SYS.tertiary };
    const c = native.checkTitleKeys(path);
    if (c.unreadable || !c.count) return { text: L("keys_validation_not_title"), icon: "circle-x", color: SYS.red };
    return { text: L("keys_validation_valid", Lc("count_games", c.count)), icon: "circle-check", color: SYS.green };
  };

  /// Dropped or chosen files are sorted into the matching slot by content
  const place = (path: string, preferred: "prod" | "title") => {
    const kind = native.detectKeyFile(path);
    if (kind === "title") title.set(path);
    else if (kind === "prod") prod.set(path);
    else if (preferred === "title") title.set(path);
    else prod.set(path);
  };
  const choose = async (which: "prod" | "title") => {
    const path = await native.pickKeys(which === "prod" ? L("keys_choose_prod_message") : L("keys_choose_title_message"));
    if (path) place(path, which);
  };

  const done = () => {
    if (!prodValid()) return;
    const changed = prod() !== keysPath() || title() !== titleKeysPath();
    keysPath.set(prod());
    titleKeysPath.set(title());
    refreshKeys();
    if (changed) queue.loadMissingMetadata();
    props.onClose();
  };
  const remove = async () => {
    if (await confirm(L("keys_remove_title"), L("keys_remove_message"), L("action_remove"))) {
      keysPath.set(null);
      refreshKeys();
      props.onClose();
    }
  };

  return (
    <View style={{ padding: 22, gap: 14 }}>
      <View style={{ flexDirection: "row", gap: 14 }}>
        <SysIcon name="key-round" size={30} color="rgba(255,255,255,0.85)" />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: SYS.text, fontSize: 15, fontWeight: "600" }}>{L("settings_tab_keys")}</Text>
          <Text style={{ color: SYS.secondary, fontSize: 12 }}>{L("keys_sheet_message")}</Text>
        </View>
      </View>

      <SectionLabel text={L("keys_section_prod")} />
      <DropWell path={prod()} placeholder={L("keys_drop_prod")} onDrop={(p) => place(p, "prod")} onPress={() => choose("prod")} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flex: 1, flexDirection: "row" }}>
          <Status status={prodStatus()} textColor={SYS.text} />
        </View>
        <Button title={L("keys_choose_file")} onPress={() => choose("prod")} />
      </View>
      <If when={prodCheck() && ignoredKeysMessage(prodCheck()!.ignored)}>
        {(message) => <Text style={{ color: SYS.tertiary, fontSize: 11 }}>{message()}</Text>}
      </If>

      <SectionLabel text={L("keys_section_title")} />
      <Text style={{ color: SYS.secondary, fontSize: 11 }}>
        {L("keys_title_note")}
      </Text>
      <DropWell path={title()} placeholder={L("keys_drop_title")} onDrop={(p) => place(p, "title")} onPress={() => choose("title")} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flex: 1, flexDirection: "row" }}>
          <Status status={titleStatus()} textColor={SYS.text} />
        </View>
        <If when={title()}>
          <Button title={L("queue_clear")} onPress={() => title.set(null)} />
        </If>
        <Button title={L("keys_choose_file")} onPress={() => choose("title")} />
      </View>

      <Text style={{ color: SYS.tertiary, fontSize: 11 }}>{L("keys_privacy")}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4 }}>
        <If when={keysPath()}>
          <Button title={L("keys_remove_prod")} onPress={remove} />
        </If>
        <View style={{ flex: 1 }} />
        <Button title={L("action_cancel")} onPress={props.onClose} />
        <Button title={L("action_done")} primary disabled={!prodValid()} onPress={done} testID="keys-done" />
      </View>
    </View>
  );
}

function SectionLabel(props: { text: string }) {
  return <Text style={{ color: SYS.secondary, fontSize: 11, fontWeight: "600", marginTop: 2 }}>{props.text}</Text>;
}

/// Drop zone: shows the chosen file; files can also be dragged here
function DropWell(props: { path: string | null; placeholder: string; onDrop: (path: string) => void; onPress: () => void }) {
  const dragging = signal(false);
  return (
    <View
      onFileDrop={(e: any) => {
        dragging.set(false);
        const path = e.uris.map(pathFromUrl)[0];
        if (path) props.onDrop(path);
      }}
      onFileDragEnter={() => dragging.set(true)}
      onFileDragLeave={() => dragging.set(false)}
      onPress={() => !props.path && props.onPress()}
      style={{
        height: 72,
        borderRadius: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingHorizontal: 22,
        backgroundColor: dragging() ? "rgba(10,132,255,0.15)" : "rgba(255,255,255,0.05)",
        borderWidth: 1,
        borderStyle: props.path ? "solid" : "dashed",
        borderColor: dragging() ? SYS.accent : props.path ? SYS.border : "rgba(255,255,255,0.25)",
      }}
    >
      <SysIcon name={props.path ? "file" : "file-plus"} size={28} color={props.path ? "rgba(255,255,255,0.9)" : SYS.tertiary} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ color: props.path ? SYS.text : SYS.secondary, fontSize: 13, fontWeight: props.path ? "500" : "400" }}>
          {props.path ? fileName(props.path) : props.placeholder}
        </Text>
        <If when={props.path}>
          {(path) => (
            <Text style={{ color: SYS.secondary, fontSize: 11, numberOfLines: 1, textOverflow: "ellipsis-middle" }}>
              {native.displayPath(path().slice(0, path().length - fileName(path()).length - 1))}
            </Text>
          )}
        </If>
      </View>
    </View>
  );
}
