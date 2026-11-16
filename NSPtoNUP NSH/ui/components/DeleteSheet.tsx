// Delete-game confirmation (HIG): the title is a short question, and the item name goes in the body;
// NUP and NSP (base game, update, DLC) can each be moved to the Trash: only NUP (the converted file) is checked by default,
// NSP files are the originals and are kept by default;
// neither "Cancel" nor the red "Delete" is the default button, so Return does nothing; Esc cancels.
// If moving files to the Trash fails, the game is kept and the reason is shown.

import { signal, Text, untracked, View } from "nsh";
import { errorMsg, L, text } from "../i18n";
import { fileName, native } from "../native";
import { showError, trashName } from "../state/actions";
import { contents, game as findGame, nupExists } from "../state/library";
import * as queue from "../state/queue";
import { deleteSheet } from "../state/ui";
import { Checkbox, Sheet, SYS } from "./sys";

export function DeleteSheet() {
  const close = () => deleteSheet.set(null);
  return (
    <Sheet open={!!deleteSheet()} onCancel={close} width={300} label={L("home_action_delete")}>
      <Each of={deleteSheet() ? [deleteSheet()!] : []}>
        {(request) => <DeleteContent id={request().id} preselect={request().preselectFiles} onClose={close} />}
      </Each>
    </Sheet>
  );
}

function DeleteContent(props: { id: string; preselect: boolean; onClose: () => void }) {
  const id = untracked(() => props.id);
  const g = findGame(id);
  if (!g) {
    props.onClose();
    return null;
  }
  // Text and buttons stay fixed so the layout doesn't jump when toggling
  const files: { kind: "NSP" | "NUP"; path: string; size: number }[] = [];
  if (native.fileInfo(g.nspPath).exists) files.push({ kind: "NSP", path: g.nspPath, size: g.fileSize });
  // Attached updates and DLC are also this game's NSPs
  for (const c of contents(g)) if (native.fileInfo(c.nspPath).exists) files.push({ kind: "NSP", path: c.nspPath, size: c.fileSize });
  if (g.nupPath && nupExists(g)) files.push({ kind: "NUP", path: g.nupPath, size: native.fileInfo(g.nupPath).size });

  // One option per file kind: NUP first (checked by default), NSP after (unchecked by default; checked when preselect is set)
  const groups = (["NUP", "NSP"] as const)
    .map((kind) => {
      const matched = files.filter((f) => f.kind === kind);
      return { kind, count: matched.length, size: matched.reduce((s, f) => s + f.size, 0) };
    })
    .filter((group) => group.count > 0);
  const checked = signal<Record<"NSP" | "NUP", boolean>>({ NUP: true, NSP: untracked(() => props.preselect) });

  const remove = async () => {
    const chosen = checked();
    props.onClose();
    const failures: string[] = [];
    for (const file of files.filter((f) => chosen[f.kind])) {
      await native.trash(file.path).catch((error) => failures.push(L("contents_skip_line", fileName(file.path), text(errorMsg(error)))));
    }
    if (failures.length) {
      // Some files couldn't be moved to the Trash: keep the game so the user can deal with them and delete again
      showError(`${failures.join("\n")}\n\n${L("trash_failed_game_kept")}`, L("trash_failed_title_in", trashName()));
      return;
    }
    queue.removeGames([id]);
  };

  return (
    <View style={{ padding: 18, gap: 12, alignItems: "center" }}>
      <Text style={{ color: SYS.text, fontSize: 13, fontWeight: "700", textAlign: "center" }}>{L("delete_title")}</Text>
      <Text style={{ color: SYS.text, fontSize: 12, textAlign: "center" }}>{L("delete_message", g.name)}</Text>
      <If when={groups.length > 0}>
        <View style={{ alignSelf: "stretch", gap: 8 }}>
          <Each of={groups}>
            {(group) => (
              <View style={{ gap: 2 }}>
                <Checkbox
                  checked={checked()[group().kind]}
                  onChange={(on) => checked.set({ ...checked(), [group().kind]: on })}
                  label={L("delete_move_kind_to_trash", group().kind, trashName())}
                />
                <Text style={{ color: SYS.secondary, fontSize: 11, paddingLeft: 22 }}>
                  {`${group().kind === "NUP" ? L("delete_note_nup") : group().count > 1 ? L("delete_note_nsp_count", group().count) : L("delete_note_nsp")} · ${native.formatBytes(group().size)}`}
                </Text>
              </View>
            )}
          </Each>
        </View>
      </If>
      <View style={{ flexDirection: "row", gap: 8, alignSelf: "stretch", marginTop: 4 }}>
        <AlertButton title={L("action_cancel")} onPress={props.onClose} />
        <AlertButton title={L("action_delete")} destructive onPress={remove} testID="delete-confirm" />
      </View>
    </View>
  );
}

/// Buttons at the bottom of the alert (like system alerts: equal width, side by side)
function AlertButton(props: { title: string; onPress: () => void; destructive?: boolean; testID?: string }) {
  return (
    <View
      role="button"
      testID={props.testID}
      accessibilityLabel={props.title}
      onPress={props.onPress}
      style={{
        flex: 1,
        height: 30,
        borderRadius: 15,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: props.destructive ? "rgba(255,69,58,0.35)" : "rgba(255,255,255,0.12)",
      }}
      hoverStyle={{ backgroundColor: props.destructive ? "rgba(255,69,58,0.45)" : "rgba(255,255,255,0.18)" }}
      activeStyle={{ backgroundColor: props.destructive ? "rgba(255,69,58,0.55)" : "rgba(255,255,255,0.25)" }}
    >
      <Text style={{ color: props.destructive ? "#FF6961" : SYS.text, fontSize: 13, fontWeight: "500" }}>{props.title}</Text>
    </View>
  );
}
