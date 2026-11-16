// Add files or folders: show detection progress first, then a summary list (check items, then add them in one go).
// With only one new game (and nothing to add to existing games), skip the list and confirm via the "Add Game" sheet instead.

import { Image, Scroll, signal, Text, untracked, View } from "nsh";
import { errorMsg, L, Lc, msg, text } from "../i18n";
import { fileName, native } from "../native";
import { reportSkipped } from "../state/actions";
import { extrasOf, fileCount, groupSize, groupSummary, makePlan, type ImportGroup, type ImportPlan } from "../state/importPlan";
import { coverUrl, game as findGame, iconUrl, type Skip } from "../state/library";
import * as queue from "../state/queue";
import { validKeysPath, validTitleKeysPath } from "../state/settings";
import { editorSheet, importSheet } from "../state/ui";
import { Button, Checkbox, Group, Separator, Sheet, SheetButtons, SheetTitle, SYS, SysIcon } from "./sys";

/// A game in the list
interface ImportItem {
  group: ImportGroup;
  name: string;
  icon: string | null;
}

export function ImportSheet() {
  const close = () => importSheet.set(null);
  return (
    <Sheet open={!!importSheet()} onCancel={close} width={640} height={480} label={L("add_game_title")}>
      <Each of={importSheet() ? [importSheet()!] : []}>
        {(request) => <ImportContent nsps={request().nsps} sourceName={request().sourceName} others={request().others} onClose={close} />}
      </Each>
    </Sheet>
  );
}

function ImportContent(props: { nsps: string[]; sourceName: string | null; others: Skip[]; onClose: () => void }) {
  const nsps = untracked(() => props.nsps);
  const others = untracked(() => props.others);
  const done = signal(0);
  const current = signal(nsps[0] ?? "");
  const result = signal<{ plan: ImportPlan; items: ImportItem[]; versions: Record<string, string> } | null>(null);
  const unchecked = signal<Set<number>>(new Set());
  const showSkipped = signal(false);
  let cancelled = false;
  /// Temporary icon saved while reading the name
  const temps: string[] = [];

  const finish = () => {
    cancelled = true;
    temps.forEach(native.removeFile);
    props.onClose();
  };

  // Detect and group all NSPs; read new games' names and icons, and updates' display versions
  (async () => {
    const keys = validKeysPath()!;
    const titleKeys = validTitleKeysPath();
    try {
      const identified = await native.identify(nsps, keys, (n) => {
        done.set(n);
        current.set(nsps[Math.min(n, nsps.length - 1)] ?? "");
      });
      if (cancelled) return;
      const plan = makePlan(
        identified.flatMap((r) => (r.content ? [r.content] : [])),
        identified.filter((r) => !r.content).map((r): Skip => [r.path, r.error ?? msg("error_nsp_unrecognized")]),
      );
      const items: ImportItem[] = [];
      const versions: Record<string, string> = {};
      for (const group of plan.groups) {
        if (cancelled) return;
        const item: ImportItem = { group, name: group.base ? fileName(group.base.path).replace(/\.nsp$/i, "") : group.baseTitleId, icon: null };
        const existing = group.existingGameId ? findGame(group.existingGameId) : undefined;
        if (existing) {
          item.name = existing.name;
          item.icon = iconUrl(existing) ?? coverUrl(existing);
        } else if (group.base) {
          const icon = native.tempPath("icon.jpg");
          temps.push(icon);
          const info = await native.probe(group.base.path, keys, titleKeys, icon).catch(() => null);
          if (info?.name) item.name = info.name;
          item.icon = info?.icon ?? null;
        }
        if (group.update) {
          // Fall back to the version number (e.g. "Version 9") when the display version can't be read
          const info = await native.probe(group.update.path, keys, titleKeys, null, true).catch(() => null);
          if (info?.displayVersion) versions[group.update.path] = info.displayVersion;
        }
        items.push(item);
      }
      if (cancelled) return;
      // Only one new game: hand it to the "Add Game" sheet to confirm
      if (items.length === 1 && !items[0].group.existingGameId && items[0].group.base) {
        const group = items[0].group;
        cancelled = true;
        temps.forEach(native.removeFile);
        props.onClose();
        setTimeout(
          () =>
            editorSheet.set({
              mode: "add",
              items: [{ nsp: group.base!.path, extras: extrasOf(group) }],
              versions,
              onDone: () => reportSkipped([...plan.skipped, ...others]),
            }),
          0,
        );
        return;
      }
      result.set({ plan, items, versions });
      if (!items.length && plan.skipped.length) showSkipped.set(true);
    } catch (error) {
      if (cancelled) return;
      result.set({ plan: { groups: [], skipped: [["", errorMsg(error)]] }, items: [], versions: {} });
      showSkipped.set(true);
    }
  })();

  const chosen = () => (result()?.items ?? []).filter((_, i) => !unchecked().has(i));
  const newGameCount = () => chosen().filter((i) => !i.group.existingGameId).length;

  /// A confirmed list item: new games join the library (info is read automatically later); existing games get the updates / DLC
  const add = () => {
    const r = result();
    if (!r) return;
    for (const item of chosen()) {
      if (item.group.existingGameId) queue.attach(extrasOf(item.group), item.group.existingGameId, r.versions);
      else if (item.group.base) {
        const id = queue.addFromDraft(item.group.base.path, {
          name: item.name,
          titleId: null,
          publisher: null,
          displayVersion: null,
          localizedNames: {},
          metadataLoaded: false,
          icon: null,
          cover: null,
          coverSource: "downloaded",
        });
        queue.attach(extrasOf(item.group), id, r.versions);
      }
    }
    finish();
    if (others.length) setTimeout(() => reportSkipped(others), 0);
  };

  const found = (r: { items: ImportItem[]; plan: ImportPlan }) => {
    if (!r.items.length) return props.sourceName ? L("import_none_in", props.sourceName) : L("import_none");
    const what = Lc("count_games", r.items.length) + L("list_separator") + Lc("count_files", fileCount(r.plan));
    return props.sourceName ? L("import_found_in", props.sourceName, what) : L("import_found", what);
  };

  return (
    <View style={{ flex: 1 }}>
      <SheetTitle title={result() ? L("add_game_title") : L("import_identifying")} />
      <Separator />
      <View style={{ flex: 1, padding: 20, gap: 10 }}>
        <If
          when={result()}
          else={
            <View style={{ gap: 8 }}>
              <Text style={{ color: SYS.secondary, fontSize: 12, numberOfLines: 1, textOverflow: "ellipsis-middle" }}>
                {fileName(current())}
              </Text>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.12)", overflow: "hidden" }}>
                <View
                  style={{
                    width: "100%",
                    height: "100%",
                    backgroundColor: SYS.accent,
                    transformOrigin: "left",
                    transform: [{ scaleX: nsps.length ? done() / nsps.length : 0 }],
                    transitionProperty: "transform",
                    transitionDuration: 250,
                  }}
                />
              </View>
              <Text style={{ color: SYS.secondary, fontSize: 12 }}>{`${Math.min(done() + 1, nsps.length)} / ${nsps.length}`}</Text>
            </View>
          }
        >
          {(r) => (
            <>
              <Text style={{ color: SYS.secondary, fontSize: 12 }}>
                {found(r())}
              </Text>
              <If when={r().items.length > 0}>
                <Scroll style={{ flex: 1, borderWidth: 1, borderColor: SYS.border, backgroundColor: "#1C1C1E" }}>
                  <Each of={r().items}>
                    {(item, index) => (
                      <View>
                        <If when={index() > 0}>
                          <Separator />
                        </If>
                        <ImportRow
                          item={item()}
                          summary={groupSummary(item().group, item().group.update ? (r().versions[item().group.update!.path] ?? null) : null)}
                          checked={!unchecked().has(index())}
                          onToggle={(checked) => {
                            const next = new Set(unchecked());
                            if (checked) next.delete(index());
                            else next.add(index());
                            unchecked.set(next);
                          }}
                        />
                      </View>
                    )}
                  </Each>
                </Scroll>
              </If>
              {/* Skipped files (collapsed by default) */}
              <If when={r().plan.skipped.length > 0}>
                <View
                  role="button"
                  onPress={() => showSkipped.set(!showSkipped())}
                  style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
                >
                  <SysIcon name={showSkipped() ? "chevron-down" : "chevron-right"} size={12} color={SYS.secondary} />
                  <Text style={{ color: SYS.secondary, fontSize: 12 }}>{Lc("import_skipped_files", r().plan.skipped.length)}</Text>
                </View>
              </If>
              <If when={showSkipped()}>
                <Scroll style={{ maxHeight: r().items.length ? 120 : undefined, flex: r().items.length ? undefined : 1 }}>
                  <View style={{ gap: 3 }}>
                    <Each of={r().plan.skipped.slice(0, 50)}>
                      {(entry) => (
                        <Text style={{ color: SYS.secondary, fontSize: 11, numberOfLines: 1, textOverflow: "ellipsis-middle" }}>
                          {entry()[0] ? `${fileName(entry()[0])}　${text(entry()[1])}` : text(entry()[1])}
                        </Text>
                      )}
                    </Each>
                  </View>
                </Scroll>
              </If>
            </>
          )}
        </If>
      </View>
      <Separator />
      <SheetButtons>
        <View style={{ flex: 1 }} />
        <Button title={result() && !result()!.items.length ? L("action_done") : L("action_cancel")} onPress={finish} />
        <If when={result() && result()!.items.length > 0}>
          <Button
            title={newGameCount() > 0 ? Lc("import_add_games", newGameCount()) : L("action_add")}
            primary
            disabled={!chosen().length}
            onPress={add}
            testID="import-add"
          />
        </If>
      </SheetButtons>
    </View>
  );
}

function ImportRow(props: { item: ImportItem; summary: string; checked: boolean; onToggle: (checked: boolean) => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 10, paddingRight: 12, paddingVertical: 8 }}>
      <Checkbox checked={props.checked} onChange={props.onToggle} />
      <View style={{ width: 36, height: 36, borderRadius: 6, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" }}>
        <If when={props.item.icon} else={<SysIcon name="gamepad-2" size={18} color={SYS.tertiary} />}>
          {(src) => <Image src={src()} style={{ width: 36, height: 36, objectFit: "cover" }} />}
        </If>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: SYS.text, fontSize: 13, fontWeight: "500", numberOfLines: 1 }}>{props.item.name}</Text>
        <Text style={{ color: SYS.secondary, fontSize: 11, numberOfLines: 1 }}>{props.summary}</Text>
      </View>
      <Text style={{ color: SYS.secondary, fontSize: 12 }}>{native.formatBytes(groupSize(props.item.group))}</Text>
    </View>
  );
}
