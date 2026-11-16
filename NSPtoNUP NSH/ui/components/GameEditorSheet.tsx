// Game info sheet: viewing game details (editing an existing game) and adding a game share the same UI;
// only the title, bottom buttons, loading state and final write differ.
//   Cover | Name · Title ID · Size · Files · Cover status · Change cover
//   Basic info: Name / Publisher / Version
//   Updates & DLC: list (remove) + Add…
//   Localized names: one row per language + Add Language
// All changes are staged and only written on "Save" ("Add" when adding); Cancel changes nothing.

import { cleanup, effect, Scroll, signal, Text, untracked, View } from "nsh";
import { Menu } from "nsh/desktop";
import { errorMsg, firstLine, L, Lc, text, type Msg } from "../i18n";
import { fileName, native, type NspContent } from "../native";
import { showError } from "../state/actions";
import { baseTitleId } from "../state/importPlan";
import {
  contentLabel,
  contents as attachedOf,
  coverUrl,
  game as findGame,
  sortContents,
  updateGame,
  type AttachedContent,
  type CoverSource,
  type Game,
} from "../state/library";
import * as queue from "../state/queue";
import { autoCover, validKeysPath, validTitleKeysPath } from "../state/settings";
import { editorSheet, type EditorRequest } from "../state/ui";
import { CoverView, LANGUAGES, languageName, LocalizedHelpButton, sortedNames } from "./forms";
import {
  Button,
  Group,
  SectionTitle,
  Separator,
  Sheet,
  SheetButtons,
  SheetTitle,
  sheetSize,
  Status,
  SYS,
  SysIcon,
  TextField,
  type StatusInfo,
} from "./sys";

export function GameEditorSheet() {
  const request = () => editorSheet();
  /// Index of the current game when adding several
  const index = signal(0);
  effect(() => {
    request();
    untracked(() => index.set(0));
  });
  const close = () => {
    const r = untracked(request);
    editorSheet.set(null);
    if (r?.mode === "add") setTimeout(() => r.onDone?.(), 0);
  };
  const key = () => {
    const r = request();
    if (!r) return null;
    return r.mode === "edit" ? `edit:${r.id}` : `add:${index()}:${r.items[index()]?.nsp ?? ""}`;
  };
  return (
    <Sheet open={!!request()} onCancel={() => close()} width={sheetSize().width} height={sheetSize().height} label={L("edit_game_title")}>
      {/* Rebuild the whole form when switching games (the next one when adding) */}
      <Each of={key() ? [key()!] : []}>
        {() => {
          const r = untracked(request)!;
          return (
            <EditorContent
              request={r}
              index={untracked(index)}
              onNext={() => {
                if (r.mode === "add" && untracked(index) + 1 < r.items.length) index.set(untracked(index) + 1);
                else close();
              }}
              onClose={close}
            />
          );
        }}
      </Each>
    </Sheet>
  );
}

type Phase = { kind: "reading" } | { kind: "ready" } | { kind: "noKeys" } | { kind: "failed"; message: Msg };
/// Staged cover change: applied only on "Save"
type CoverChange = { kind: "unchanged" } | { kind: "replace"; path: string; source: CoverSource } | { kind: "remove" };

function EditorContent(props: { request: EditorRequest; index: number; onNext: () => void; onClose: () => void }) {
  const request = props.request;
  const adding = request.mode === "add";
  const item = request.mode === "add" ? request.items[props.index] : null;

  // Adding: draft game (not in the library); editing: the game in the library
  const draft = signal<Game | null>(
    item
      ? {
          id: "draft",
          nspPath: item.nsp,
          fileSize: native.fileInfo(item.nsp).size,
          addedAt: new Date().toISOString(),
          name: fileName(item.nsp).replace(/\.nsp$/i, ""),
          localizedNames: {},
          metadataLoaded: false,
          coverLookupFailed: false,
          status: "notConverted",
          warnings: [],
        }
      : null,
  );
  const editId = request.mode === "edit" ? request.id : null;
  const game = (): Game | null => (adding ? draft() : (findGame(editId) ?? null));

  const initial = untracked(game);
  const name = signal(initial?.name ?? "");
  const publisher = signal(initial?.publisher ?? "");
  const version = signal(initial?.displayVersion ?? "");
  const localized = signal<Record<string, string>>(initial?.localizedNames ?? {});
  const phase = signal<Phase>(adding ? { kind: "reading" } : { kind: "ready" });
  const cover = signal<CoverChange>({ kind: "unchanged" });
  const downloading = signal(false);
  const draftIcon = signal<string | null>(null);
  // Updates & DLC: staged changes
  const pending = signal<NspContent[]>(item?.extras ?? []);
  const pendingVersions = signal<Record<string, string>>(request.mode === "add" ? request.versions : {});
  const removed = signal<Set<string>>(new Set());
  const identifying = signal(false);

  /// Temporary files: handed to the library on Add / Save, deleted on Cancel
  const temps = new Set<string>();
  let finished = false;
  cleanup(() => {
    if (!finished) temps.forEach((t) => native.removeFile(t));
  });
  const tempPath = (name: string) => {
    const path = native.tempPath(name);
    temps.add(path);
    return path;
  };

  // Editing: close when the game is deleted
  effect(() => {
    if (!adding && !findGame(editId)) untracked(props.onClose);
  });

  // Adding: read game info (nxpatch only reads the Meta and Control NCAs)
  if (item) {
    const keys = validKeysPath();
    if (!keys) phase.set({ kind: "noKeys" });
    else {
      const update = item.extras.find((e) => e.kind === "update");
      const updateVersion = update ? (request.mode === "add" ? request.versions[update.path] : undefined) : undefined;
      native
        .probe(item.nsp, keys, validTitleKeysPath(), tempPath("icon.jpg"))
        .then((result) => {
          if (finished) return;
          const current = draft()!;
          const next: Game = {
            ...current,
            titleId: result.titleId,
            name: result.name ?? current.name,
            publisher: result.publisher,
            // Show the update's version when there is an update
            displayVersion: updateVersion ?? result.displayVersion,
            localizedNames: result.localizedNames,
            metadataLoaded: true,
          };
          draft.set(next);
          draftIcon.set(result.icon);
          name.set(next.name);
          publisher.set(next.publisher ?? "");
          version.set(next.displayVersion ?? "");
          localized.set(next.localizedNames);
          phase.set({ kind: "ready" });
          if (autoCover()) downloadCover();
        })
        .catch((error) => !finished && phase.set({ kind: "failed", message: errorMsg(error) }));
    }
  }

  // Editing: locked while converting; adding: not editable while reading info or after it fails
  const locked = () => {
    if (!adding) return queue.isBusy(editId!);
    const p = phase().kind;
    return p === "reading" || p === "failed";
  };

  const lockStatus = (): StatusInfo | null => {
    if (!adding) return locked() ? { text: L("edit_locked_converting"), clock: true } : null;
    const p = phase();
    switch (p.kind) {
      case "reading":
        return { text: L("add_status_reading"), clock: true };
      case "ready":
        return { text: L("add_status_ready"), icon: "circle-check", color: SYS.green };
      case "noKeys":
        return { text: L("add_status_no_keys"), icon: "key-round", color: SYS.orange };
      case "failed":
        return { text: L("add_status_failed", firstLine(p.message)), icon: "circle-x", color: SYS.red };
    }
  };

  // MARK: Cover

  const coverSrc = () => {
    const c = cover();
    if (c.kind === "replace") return c.path;
    if (c.kind === "remove") return null;
    const g = game();
    return adding ? null : coverUrl(g ?? undefined);
  };
  const coverStatus = (): StatusInfo => {
    if (adding && phase().kind === "reading") return { text: L("cover_status_reading"), clock: true };
    if (downloading()) return { text: L("cover_status_downloading"), clock: true };
    const c = cover();
    if (c.kind === "replace") {
      if (adding) return { text: c.source === "manual" ? L("cover_status_manual") : L("cover_status_downloaded"), icon: "circle-check", color: SYS.green };
      return {
        text: c.source === "manual" ? L("cover_status_new_pending") : L("cover_status_redownload_pending"),
        icon: "edit-info",
        color: SYS.accent,
      };
    }
    if (c.kind === "remove") return { text: L("cover_status_remove_pending"), icon: "circle-x", color: SYS.orange };
    const g = game();
    if (!adding && g?.coverFile) {
      return { text: g.coverSource === "manual" ? L("cover_status_manual") : L("cover_status_downloaded"), icon: "circle-check", color: SYS.green };
    }
    return { text: L("cover_status_none"), icon: "triangle-alert", color: SYS.orange };
  };

  const discardTempCover = () => {
    const c = untracked(cover);
    if (c.kind === "replace") {
      native.removeFile(c.path);
      temps.delete(c.path);
    }
  };

  const stageImage = async (image: string) => {
    if (untracked(locked)) return;
    const path = tempPath("cover.jpg");
    try {
      await native.saveCover(image, path);
      discardTempCover();
      cover.set({ kind: "replace", path, source: "manual" });
    } catch (error) {
      showError(errorMsg(error), L("error_image_unusable_title"));
    }
  };

  async function downloadCover() {
    const titleId = untracked(game)?.titleId;
    if (!titleId || untracked(downloading)) return;
    const path = tempPath("cover.jpg");
    downloading.set(true);
    try {
      await native.downloadCover(titleId, path);
      if (finished) return;
      discardTempCover();
      cover.set({ kind: "replace", path, source: "downloaded" });
    } catch (error) {
      // Don't show an alert when auto-download fails while adding: the cover status shows "No cover" and one can be chosen manually
      if (!adding && !finished) showError(L("error_cover_download_choose_hint", errorMsg(error)), L("error_cover_download_title"));
    }
    downloading.set(false);
  }

  const coverMenu = () => {
    const g = game();
    const c = cover();
    const hasCover = c.kind === "replace" || (c.kind === "unchanged" && !adding && !!g?.coverFile);
    Menu.popup(
      [
        {
          label: L("cover_menu_choose"),
          onSelect: async () => {
            const image = await native.pickImage();
            if (image) stageImage(image);
          },
        },
        { label: L("cover_menu_redownload"), disabled: !g?.titleId || downloading(), onSelect: () => downloadCover() },
        hasCover ? { type: "separator" } : null,
        hasCover
          ? {
              label: L("action_remove_cover"),
              onSelect: () => {
                discardTempCover();
                cover.set(!adding && g?.coverFile ? { kind: "remove" } : { kind: "unchanged" });
              },
            }
          : null,
      ].filter(Boolean) as any,
    );
  };

  // MARK: Updates & DLC

  /// Current list: attached (not removed) + staged new content
  const displayed = (): AttachedContent[] => {
    const g = game();
    const kept = (adding || !g ? [] : attachedOf(g)).filter((c) => !removed().has(c.nspPath));
    const added = pending().map((p) => queue.toAttached(p, pendingVersions()[p.path] ?? null));
    return sortContents([...kept, ...added]);
  };

  const removeContent = (path: string) => {
    if (pending().some((p) => p.path === path)) pending.set(pending().filter((p) => p.path !== path));
    else removed.set(new Set([...removed(), path]));
  };

  /// Choose NSPs or a folder: after detection keep only this game's updates / DLC, and explain why the rest were skipped
  async function addContent() {
    const keys = validKeysPath();
    if (!keys) return showError(L("contents_need_keys"), L("error_unrecognized_title"));
    const titleId = untracked(game)?.titleId;
    if (!titleId) return showError(L("contents_no_title_id"), L("contents_cannot_add_title"));
    const paths = await native.pickNsps(L("contents_panel_message"));
    if (!paths.length) return;
    const nsps = native.scan(paths).nsps;
    const known = new Set([...untracked(displayed).map((c) => c.nspPath), untracked(game)?.nspPath ?? ""]);
    const skipped: string[] = [];
    if (!nsps.length) skipped.push(L("error_no_nsp_found_message"));
    identifying.set(true);
    try {
      const results = await native.identify(nsps.filter((p) => !known.has(p)), keys);
      for (const result of results) {
        const label = fileName(result.path);
        const content = result.content;
        if (!content) {
          skipped.push(L("contents_skip_line", label, result.error ?? { key: "error_nsp_unrecognized" }));
          continue;
        }
        if (content.kind === "base") {
          skipped.push(L("contents_skip_line", label, L("contents_skip_is_base")));
          continue;
        }
        if (baseTitleId(content.titleId) !== baseTitleId(titleId)) {
          skipped.push(L("contents_skip_line", label, L("contents_skip_other_game", baseTitleId(content.titleId))));
          continue;
        }
        const current = untracked(displayed).find(
          (c) => c.kind === content.kind && (c.kind === "update" || c.titleId === content.titleId),
        );
        if (current && current.version >= content.version) {
          skipped.push(L("contents_skip_line", label, L("skip_newer_version_exists")));
          continue;
        }
        // Replace the old update or the same DLC
        if (current) removeContent(current.nspPath);
        pending.set([...untracked(pending), content]);
        if (content.kind === "update") {
          const info = await native.probe(content.path, keys, validTitleKeysPath(), null, true).catch(() => null);
          if (info?.displayVersion) {
            pendingVersions.set({ ...untracked(pendingVersions), [content.path]: info.displayVersion });
            version.set(info.displayVersion);
          }
        }
      }
    } catch (error) {
      skipped.push(text(errorMsg(error)));
    }
    identifying.set(false);
    if (skipped.length) showError(skipped.slice(0, 20).join("\n"), Lc("contents_not_added_title", skipped.length));
  }

  // Context menu "Add Update or DLC…": choose right after opening
  if (request.mode === "edit" && request.addContent) setTimeout(() => addContent(), 0);

  // MARK: Save

  const trim = (s: string) => s.trim() || null;

  const save = () => {
    const g = untracked(game);
    if (!g || untracked(locked)) return;
    finished = true;
    if (adding) {
      const c = untracked(cover);
      const id = queue.addFromDraft(g.nspPath, {
        name: trim(untracked(name)) ?? g.name,
        titleId: g.titleId ?? null,
        publisher: trim(untracked(publisher)),
        displayVersion: trim(untracked(version)),
        localizedNames: cleanNames(untracked(localized)),
        metadataLoaded: g.metadataLoaded,
        icon: untracked(draftIcon),
        cover: c.kind === "replace" ? c.path : null,
        coverSource: c.kind === "replace" ? c.source : "downloaded",
      });
      // The version confirmed in the form wins
      queue.attach(untracked(pending), id, untracked(pendingVersions), false);
      // Unused temporary files
      temps.forEach((t) => t !== untracked(draftIcon) && (c.kind !== "replace" || t !== c.path) && native.removeFile(t));
      props.onNext();
      return;
    }
    updateGame(g.id, () => ({
      name: trim(untracked(name)) ?? g.name,
      publisher: trim(untracked(publisher)),
      displayVersion: trim(untracked(version)),
      localizedNames: cleanNames(untracked(localized)),
    }));
    if (untracked(removed).size) queue.detach(untracked(removed), g.id);
    if (untracked(pending).length) queue.attach(untracked(pending), g.id, untracked(pendingVersions), false);
    const c = untracked(cover);
    if (c.kind === "replace") {
      try {
        queue.applyCover(g.id, c.path, c.source);
      } catch (error) {
        showError(errorMsg(error), L("error_cover_save_title"));
      }
    } else if (c.kind === "remove") queue.removeCover(g.id);
    temps.forEach((t) => (c.kind !== "replace" || t !== c.path) && native.removeFile(t));
    props.onClose();
  };

  /// Cancel: discard all changes (HIG: no extra confirmation on cancel); when adding several, "Skip" the current game
  const cancel = () => (adding ? props.onNext() : props.onClose());
  const total = request.mode === "add" ? request.items.length : 1;

  const meta = () => {
    const g = game();
    return [g?.titleId, g ? native.formatBytes(g.fileSize) : null].filter(Boolean).join(" · ");
  };

  return (
    <View style={{ flex: 1 }}>
      <SheetTitle
        title={adding ? L("add_game_title") : L("edit_game_title")}
        trailing={total > 1 ? <Text style={{ color: SYS.secondary, fontSize: 12 }}>{L("add_counter", props.index + 1, total)}</Text> : undefined}
      />
      <Separator />
      <Scroll style={{ flex: 1 }}>
        <View style={{ padding: 20, gap: 20 }}>
          {/* Cover and summary */}
          <View style={{ flexDirection: "row", gap: 20 }}>
            <CoverView
              src={coverSrc()}
              width={320}
              hint={L("cover_drop_hint")}
              loading={downloading() || (adding && phase().kind === "reading")}
              onDropImage={locked() ? undefined : stageImage}
            />
            <View style={{ flex: 1, height: 180, gap: 6 }}>
              <Text style={{ color: SYS.text, fontSize: 17, fontWeight: "600", numberOfLines: 1 }}>{game()?.name ?? ""}</Text>
              <Text style={{ color: SYS.secondary, fontSize: 12, fontVariant: ["tabular-nums"] }}>{meta()}</Text>
              <Text style={{ color: SYS.secondary, fontSize: 12, numberOfLines: 1, textOverflow: "ellipsis-middle" }}>
                {fileName(game()?.nspPath ?? "")}
              </Text>
              <View style={{ flex: 1 }} />
              <Status status={coverStatus()} textColor={SYS.text} />
              <View style={{ flexDirection: "row", marginTop: 4 }}>
                <Button title={L("cover_change_menu")} trailingIcon="chevrons-up-down" disabled={locked()} onPress={coverMenu} minWidth={0} />
              </View>
            </View>
          </View>
          <Separator />

          {/* Basic info */}
          <View style={{ gap: 10 }}>
            <SectionTitle title={L("section_basic_info")} />
            <FieldRow label={L("field_name_label")}>
              <TextField value={name()} onChange={name.set} placeholder={L("field_name_placeholder")} disabled={locked()} testID="name-field" />
            </FieldRow>
            <FieldRow label={L("field_publisher_label")}>
              <TextField value={publisher()} onChange={publisher.set} placeholder={L("field_publisher_placeholder")} disabled={locked()} />
            </FieldRow>
            <FieldRow label={L("field_version_label")}>
              <TextField value={version()} onChange={version.set} placeholder={L("field_version_placeholder")} disabled={locked()} />
            </FieldRow>
          </View>

          {/* Updates & DLC */}
          <View style={{ gap: 10 }}>
            <SectionTitle
              title={L("section_contents")}
              trailing={
                <>
                  <View style={{ flex: 1 }} />
                  <If when={identifying()}>
                    <Status status={{ text: L("contents_identifying"), clock: true }} />
                  </If>
                  <Button title={L("action_add_ellipsis")} small disabled={locked() || identifying()} onPress={() => addContent()} />
                </>
              }
            />
            <Group>
              <If
                when={displayed().length > 0}
                else={
                  <Text style={{ color: SYS.secondary, fontSize: 12, paddingHorizontal: 12, paddingVertical: 10 }}>
                    {L("contents_empty")}
                  </Text>
                }
              >
                <Each of={displayed()} key={(c) => c.nspPath}>
                  {(content, i) => (
                    <ContentRow content={content()} first={i() === 0} locked={locked()} onRemove={() => removeContent(content().nspPath)} />
                  )}
                </Each>
              </If>
            </Group>
          </View>

          {/* Localized names */}
          <View style={{ gap: 10 }}>
            <SectionTitle title={L("section_localized_names")} trailing={<LocalizedHelpButton />} />
            <LocalizedEditor names={localized()} onChange={localized.set} disabled={locked()} />
          </View>
        </View>
      </Scroll>
      <Separator />
      <SheetButtons>
        <View style={{ flex: 1, flexDirection: "row" }}>
          <If when={lockStatus()}>{(s) => <Status status={s()} />}</If>
        </View>
        <If when={total > 1}>
          <Button title={L("action_cancel_all")} onPress={() => props.onClose()} />
        </If>
        <Button title={adding && total > 1 ? L("action_skip") : L("action_cancel")} onPress={cancel} testID="editor-cancel" />
        <Button title={adding ? L("action_add") : L("action_save")} primary disabled={locked()} onPress={save} testID="editor-save" />
      </SheetButtons>
    </View>
  );
}

const LABEL_WIDTH = 64;

function FieldRow(props: { label: string; children?: any }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Text style={{ width: LABEL_WIDTH, textAlign: "right", color: SYS.text, fontSize: 13 }}>{props.label}</Text>
      {props.children}
    </View>
  );
}

function ContentRow(props: { content: AttachedContent; first: boolean; locked: boolean; onRemove: () => void }) {
  const exists = () => native.fileInfo(props.content.nspPath).exists;
  return (
    <View>
      <If when={!props.first}>
        <Separator />
      </If>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 12, paddingRight: 10, paddingVertical: 8 }}>
        <Text style={{ width: 40, color: SYS.text, fontSize: 12, fontWeight: "500" }}>{props.content.kind === "update" ? L("content_kind_update") : L("content_kind_dlc")}</Text>
        <Text style={{ color: SYS.text, fontSize: 12 }}>{contentLabel(props.content)}</Text>
        <Text
          style={{
            flex: 1,
            color: exists() ? SYS.secondary : SYS.red,
            fontSize: 11,
            numberOfLines: 1,
            textOverflow: "ellipsis-middle",
          }}
        >
          {fileName(props.content.nspPath) + (exists() ? "" : L("contents_file_missing"))}
        </Text>
        <Text style={{ color: SYS.secondary, fontSize: 12 }}>{native.formatBytes(props.content.fileSize)}</Text>
        <View
          role="button"
          accessibilityLabel={L("action_remove")}
          onPress={() => !props.locked && props.onRemove()}
          style={{ opacity: props.locked ? 0.35 : 1, padding: 2 }}
        >
          <SysIcon name="circle-minus" size={15} color={SYS.secondary} />
        </View>
      </View>
    </View>
  );
}

const cleanNames = (names: Record<string, string>) => Object.fromEntries(Object.entries(names).filter(([, v]) => v.trim()));

/// Visual editor for localized names: one row per language (language | name | remove), plus an "Add Language" menu
function LocalizedEditor(props: { names: Record<string, string>; onChange: (names: Record<string, string>) => void; disabled: boolean }) {
  const available = () => LANGUAGES.filter((tag) => !(tag in props.names));
  const set = (tag: string, value: string) => props.onChange({ ...props.names, [tag]: value });
  const remove = (tag: string) => {
    const next = { ...props.names };
    delete next[tag];
    props.onChange(next);
  };
  return (
    <View style={{ gap: 6 }}>
      <Each of={sortedNames(props.names)} key={([tag]) => tag}>
        {(row) => (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={{ width: LABEL_WIDTH, textAlign: "right", color: SYS.text, fontSize: 12, numberOfLines: 1 }}>
              {languageName(row()[0])}
            </Text>
            <TextField value={row()[1]} onChange={(v) => set(row()[0], v)} placeholder={L("localized_field_placeholder", languageName(row()[0]))} disabled={props.disabled} />
            <View
              role="button"
              accessibilityLabel={L("localized_remove_tooltip", languageName(row()[0]))}
              onPress={() => !props.disabled && remove(row()[0])}
              style={{ opacity: props.disabled ? 0.35 : 1, padding: 2 }}
            >
              <SysIcon name="circle-minus" size={15} color={SYS.secondary} />
            </View>
          </View>
        )}
      </Each>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: LABEL_WIDTH + 6 }}>
        <Button
          title={`＋ ${L("localized_add_language")}`}
          small
          disabled={props.disabled || !available().length}
          onPress={() => Menu.popup(available().map((tag) => ({ label: languageName(tag), onSelect: () => set(tag, "") })))}
        />
        <If when={!Object.keys(props.names).length}>
          <Text style={{ color: SYS.tertiary, fontSize: 11 }}>{L("localized_empty")}</Text>
        </If>
      </View>
    </View>
  );
}
