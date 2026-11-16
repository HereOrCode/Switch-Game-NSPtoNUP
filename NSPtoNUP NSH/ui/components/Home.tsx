// Console-style main screen:
//   Top bar    App name · version                     (Queue)(Keys)(Add)(Settings)
//   Categories All / Completed / Failed / Converting           n/n (Search)
//   Carousel   square game icons, selected one enlarged
//   Background selected game's 16:9 cover fills the window
//   Bottom-left game name · Title ID · status · progress · primary button + round buttons

import { appInfo, computed, createMotion, effect, keymap, signal, Text, untracked, View, type ViewRef } from "nsh";
import { Input } from "nsh/base";
import { titleBar } from "nsh/desktop";
import { firstLine, L, Lc, text as msgText } from "../i18n";
import { extension, native, pathFromUrl } from "../native";
import * as actions from "../state/actions";
import { CATEGORIES, itemState, matches, type Category } from "../state/itemState";
import { contents, contentsChanged, coverUrl, dlcsOf, game as findGame, games, iconUrl, nupExists, totalSize, updateOf, type Game } from "../state/library";
import * as queue from "../state/queue";
import { categoryShortcuts, validKeysPath } from "../state/settings";
import { STEPS } from "../state/steps";
import { editorSheet, focusGame, keysSheetOpen, logSheet, queueOpen, settingsOpen, sheetOpen } from "../state/ui";
import { Background, type BackgroundImage } from "./Background";
import { Carousel, type CarouselItem } from "./Carousel";
import { ClockBadge } from "./ClockBadge";
import { COLORS, Icon, PillButton, ProgressBar, RoundButton, TabButton, white, WHITE } from "./controls";
import type { IconName } from "./icons";

/// Queue button, used to position the floating card
export const queueButton = signal<ViewRef | undefined>(undefined);
/// Game currently selected on the home screen (used by the menu bar's "Edit Info")
export const selectedGameId = signal<string | null>(null);

export function Home() {
  const category = signal<Category>("all");
  const searching = signal(false);
  const searchText = signal("");
  const selectedId = signal<string | null>(null);
  /// The "Add" tile has focus (keyboard or switch buttons moved onto it): enlarged like the selected game; the info area and Return map to "Add NSP"
  const addFocused = signal(false);
  let searchInput: any;

  /// Sort order for the Converting category: the active conversion is -1, waiting ones follow in queue order
  const queueRank = (id: string) => {
    const list = queue.jobs();
    const index = list.findIndex((j) => j.gameId === id);
    if (index < 0) return Number.MAX_SAFE_INTEGER;
    return list[index].state() === "running" ? -1 : index;
  };

  const shown = computed(() => {
    const query = searchText().trim().toLowerCase();
    let list = games()
      .filter((g) => matches(category(), g))
      .filter(
        (g) =>
          !query ||
          g.name.toLowerCase().includes(query) ||
          (g.titleId ?? "").toLowerCase().includes(query) ||
          Object.values(g.localizedNames).some((n) => n.toLowerCase().includes(query)),
      )
      .sort((a, b) => (a.addedAt < b.addedAt ? 1 : a.addedAt > b.addedAt ? -1 : 0));
    // The active conversion comes first, waiting ones follow in queue order
    if (category() === "converting") list = list.sort((a, b) => queueRank(a.id) - queueRank(b.id));
    return list;
  });

  const selectedIndex = () => {
    const list = shown();
    const index = list.findIndex((g) => g.id === selectedId());
    return index >= 0 ? index : 0;
  };
  const selected = (): Game | undefined => shown()[selectedIndex()];
  effect(() => selectedGameId.set(selected()?.id ?? null));

  // Queue card or notification asks to select a game: switch to "All" if it isn't in the current category
  effect(() => {
    const id = focusGame();
    if (!id) return;
    untracked(() => {
      if (!shown().some((g) => g.id === id)) {
        searchText.set("");
        category.set("all");
      }
      selectedId.set(id);
    });
  });

  const items = (): CarouselItem[] => {
    const list: CarouselItem[] = shown().map((g) => ({ kind: "game", id: g.id }));
    if (category() === "all" && !searchText().trim()) list.push({ kind: "add" });
    return list;
  };

  /// Select among games only; when the user selects a game (click, right-click) the "Add" tile loses focus
  const select = (index: number) => {
    const list = shown();
    const clamped = Math.min(Math.max(index, 0), list.length - 1);
    addFocused.set(false);
    if (list[clamped]) selectedId.set(list[clamped].id);
  };
  const hasAddTile = () => items().some((i) => i.kind === "add");
  /// Arrow keys and switch buttons: move between games; after the last game comes the "Add" tile
  const move = (delta: number) => {
    if (addFocused()) {
      if (delta < 0 && shown().length) addFocused.set(false);
      return;
    }
    if (delta > 0 && selectedIndex() + delta > shown().length - 1 && hasAddTile()) return addFocused.set(true);
    select(selectedIndex() + delta);
  };
  // The "Add" tile loses focus when it isn't in the list (category change, search)
  effect(() => {
    if (!hasAddTile()) untracked(() => addFocused.set(false));
  });

  const setCategory = (value: Category) => {
    category.set(value);
    selectedId.set(null);
  };

  const toggleSearch = () => {
    if (searching()) {
      searchText.set("");
      searching.set(false);
    } else {
      searching.set(true);
      setTimeout(() => searchInput?.focus(), 0);
    }
  };

  const primary = () => {
    if (addFocused()) return actions.addNsps();
    const g = selected();
    if (g) return actions.primaryAction(g);
    if (!games().length) return validKeysPath() ? actions.addNsps() : keysSheetOpen.set(true);
    switch (emptyContent().action) {
      case "convertAll":
        return actions.convertAll();
      case "clearSearch":
        return searchText.set("");
      case "showAll":
        searchText.set("");
        return setCategory("all");
    }
  };

  // Keyboard: ←/→ switch, Return primary action, ⌘1-4 categories (must be enabled in Settings), ⌘I edit, ⌘F search, Esc closes search.
  // Ignored while a sheet is open
  const when = (f: () => void) => () => !sheetOpen() && f();
  keymap.bind("left", when(() => move(-1)), { when: "notEditing", repeat: true });
  keymap.bind("right", when(() => move(1)), { when: "notEditing", repeat: true });
  keymap.bind("enter", when(primary), { when: "notEditing" });
  keymap.bind("mod+f", when(toggleSearch));
  keymap.bind(
    "mod+i",
    when(() => {
      const g = selected();
      if (g && !addFocused()) editorSheet.set({ mode: "edit", id: g.id });
    }),
  );
  keymap.bind("escape", () => !sheetOpen() && searching() && toggleSearch(), { passThrough: true });
  CATEGORIES.forEach((c, i) => keymap.bind(`mod+${i + 1}`, when(() => categoryShortcuts() && setCategory(c.id))));

  const background = (): BackgroundImage => {
    const g = selected();
    if (!g) return { key: "empty", cover: null, icon: null, empty: true };
    return { key: `${g.id}-${g.coverFile ?? ""}-${g.iconFile ?? ""}`, cover: coverUrl(g), icon: iconUrl(g) };
  };

  const tile = (id: string) => {
    const g = findGame(id);
    const state = g ? itemState(g) : null;
    return {
      image: iconUrl(g) ?? coverUrl(g),
      name: g?.name ?? "",
      progress: state?.kind === "converting" ? state.progress : null,
      clock: state?.kind === "converting" ? ("running" as const) : state?.kind === "queued" ? ("waiting" as const) : null,
    };
  };

  /// Hint and primary button for an empty category
  const emptyContent = (): { title: string; status: string; message: string; action: "showAll" | "clearSearch" | "convertAll" } => {
    const text = searchText().trim();
    const title = CATEGORIES.find((c) => c.id === category())!.title();
    if (text) return { title: L("empty_search_title", text), status: L("empty_search_status", title), message: L("empty_search_message"), action: "clearSearch" };
    switch (category()) {
      case "done":
        return { title: L("empty_done_title"), status: L("category_done"), message: L("empty_done_message"), action: "showAll" };
      case "failed":
        return { title: L("empty_failed_title"), status: L("category_failed"), message: L("empty_failed_message"), action: "showAll" };
      case "converting": {
        const pending = queue.pendingGames().length;
        return {
          title: L("empty_converting_title"),
          status: pending > 0 ? Lc("empty_converting_pending", pending) : L("empty_converting_all_done"),
          message: L("empty_converting_message"),
          action: pending > 0 ? "convertAll" : "showAll",
        };
      }
      default:
        return { title: L("empty_all_title"), status: L("category_all"), message: L("empty_all_message"), action: "showAll" };
    }
  };

  const onDrop = (uris: string[]) => {
    const paths = uris.map(pathFromUrl);
    const keys = paths.find((p) => extension(p) === "keys");
    if (keys) actions.useKeys(keys);
    const nsps = paths.filter((p) => extension(p) === "nsp");
    if (nsps.length) actions.importNsps(nsps);
  };

  const version = appInfo().version ?? "1.0";
  const keysValid = () => !!validKeysPath();

  return (
    <View style={{ flex: 1, backgroundColor: "#000000" }} onFileDrop={(e: any) => onDrop(e.uris)}>
      <Background image={background()} />

      {/* Top bar: on the same row as the traffic-light buttons; empty space drags the window */}
      <View
        desktop={{ windowDrag: true }}
        style={{
          height: 52,
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: titleBar().left + 12,
          paddingRight: 20,
        }}
      >
        <Text style={{ color: WHITE, fontSize: 15, fontWeight: "700", marginTop: -8 }}>
          NSPtoNUP
          <Text style={{ color: white(0.55), fontSize: 11, fontWeight: "400" }}>{`  v${version}`}</Text>
        </Text>
        <View style={{ flex: 1 }} />
        <View style={{ flexDirection: "row", gap: 10 }}>
          <RoundButton
            icon="circle-arrow-down"
            hint={L("home_queue_tooltip")}
            size={32}
            badge={queue.jobs().length}
            ref={(node) => queueButton.set(node)}
            onPress={() => queueOpen.set(!queueOpen())}
            testID="queue-button"
          />
          <RoundButton
            icon="key-round"
            hint={keysValid() ? L("home_keys_configured") : L("home_keys_not_configured")}
            size={32}
            onPress={() => keysSheetOpen.set(true)}
            testID="keys-button"
          />
          <RoundButton icon="plus" hint={L("home_add_tooltip")} size={32} onPress={() => actions.addNsps()} testID="add-button" />
          <RoundButton icon="settings" hint={L("home_settings_tooltip")} size={32} onPress={() => settingsOpen.set(true)} testID="settings-button" />
        </View>
      </View>

      {/* Categories */}
      <View style={{ height: 40, marginTop: 4, flexDirection: "row", alignItems: "center", paddingLeft: 40, paddingRight: 20 }}>
        <View style={{ flexDirection: "row", gap: 24 }}>
          <Each of={CATEGORIES}>
            {(c) => (
              <TabButton
                title={c().title()}
                icon={c().icon as IconName}
                count={games().filter((g) => matches(c().id, g)).length}
                selected={category() === c().id}
                hint={categoryShortcuts() ? L("home_category_tooltip", c().title(), CATEGORIES.indexOf(c()) + 1) : undefined}
                onPress={() => setCategory(c().id)}
              />
            )}
          </Each>
        </View>
        <View style={{ flex: 1 }} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <If when={shown().length > 0}>
            <Text style={{ color: white(0.6), fontSize: 13, fontVariant: ["tabular-nums"] }}>
              {`${selectedIndex() + 1}/${shown().length}`}
            </Text>
          </If>
          <If when={searching()}>
            <SearchField
              value={searchText()}
              onChange={(v) => searchText.set(v)}
              inputRef={(node) => (searchInput = node)}
            />
          </If>
          <RoundButton icon="search" hint={L("home_search_tooltip")} size={32} onPress={toggleSearch} />
        </View>
      </View>

      <View style={{ marginTop: 16 }}>
        <Carousel
          items={items()}
          selected={selectedIndex()}
          addFocused={addFocused()}
          tile={tile}
          onSelect={select}
          onMove={move}
          onAdd={() => actions.addNsps()}
          onMenu={(index, at) => {
            const g = shown()[index];
            if (g) actions.showMenu(g, at);
          }}
        />
      </View>

      <View style={{ flex: 1 }} />
      <InfoPanel
        game={addFocused() ? undefined : selected()}
        addFocused={addFocused()}
        empty={emptyContent()}
        hasGames={games().length > 0}
        keysValid={keysValid()}
        onPrimary={primary}
        category={category()}
      />
    </View>
  );
}

function SearchField(props: { value: string; onChange: (value: string) => void; inputRef: (node: any) => void }) {
  const motion = createMotion({ enter: "fadeInRight", duration: 260 });
  return (
    <View
      style={{
        width: 220,
        height: 30,
        borderRadius: 15,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 12,
        backgroundColor: white(0.12),
        borderWidth: 1,
        borderColor: white(0.18),
        ...motion.style,
      }}
    >
      <Icon name="search" size={13} color={white(0.6)} />
      <Input
        ref={props.inputRef}
        value={props.value}
        onChange={({ value }) => props.onChange(value)}
        placeholder={L("home_search_placeholder")}
        autoCorrect={false}
        style={{ flex: 1, color: WHITE, fontSize: 13, backgroundColor: "transparent", borderWidth: 0, padding: 0 }}
      />
    </View>
  );
}

/// Bottom-left info area: game name · Title ID · status · progress · primary button + round buttons
function InfoPanel(props: {
  game: Game | undefined;
  addFocused: boolean;
  empty: { title: string; status: string; message: string; action: string };
  hasGames: boolean;
  keysValid: boolean;
  category: Category;
  onPrimary: () => void;
}) {
  const info = () => describe(props.game, props);
  return (
    <View style={{ paddingLeft: 40, paddingRight: 40, paddingBottom: 40, gap: 6, alignItems: "flex-start" }}>
      <Text
        style={{
          numberOfLines: 2,
          color: WHITE,
          fontSize: 34,
          fontWeight: "700",
          maxWidth: 720,
          textShadow: "0 1px 8px rgba(0,0,0,0.5)",
          marginBottom: 4,
        }}
      >
        {info().title}
      </Text>
      <If when={props.game?.titleId}>
        {(id) => (
          <Text style={{ color: white(0.65), fontSize: 12, fontFamily: "monospace", userSelect: "text" }}>
            {id()}
          </Text>
        )}
      </If>
      <StatusLine status={info().status} />
      <If when={info().progress != null}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 }}>
          <ProgressBar value={info().progress ?? 0} />
          <Text style={{ color: white(0.8), fontSize: 12, fontVariant: ["tabular-nums"] }}>
            {`${Math.floor((info().progress ?? 0) * 100)}%`}
          </Text>
        </View>
      </If>
      <If when={info().message}>
        {(message) => (
          <Text style={{ color: white(0.75), fontSize: 13, maxWidth: 560, marginTop: 4 }}>{message()}</Text>
        )}
      </If>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 18 }}>
        <PillButton
          title={info().primary.title}
          icon={info().primary.icon}
          disabled={info().primary.disabled}
          onPress={props.onPrimary}
          testID="primary-button"
        />
        <If when={info().secondary}>
          <PillButton title={L("menu_add_nsp")} icon="plus" onPress={() => actions.addNsps()} />
        </If>
        <If when={props.game}>
          {(g) => (
            <View style={{ flexDirection: "row", gap: 12, marginLeft: 6 }}>
              <RoundButton
                icon="ellipsis"
                hint={L("home_more_tooltip")}
                onPress={() => actions.showMenu(g())}
                testID="more-button"
              />
              <RoundButton
                icon="edit-info"
                hint={L("home_edit_tooltip")}
                disabled={queue.isBusy(g().id)}
                onPress={() => editorSheet.set({ mode: "edit", id: g().id })}
                testID="edit-button"
              />
              <RoundButton
                icon="logs"
                hint={L("home_log_tooltip")}
                disabled={!queue.latestJob(g().id)}
                onPress={() => logSheet.set(g().id)}
                testID="log-button"
              />
            </View>
          )}
        </If>
      </View>
    </View>
  );
}

export type Status =
  | { kind: "icon"; text: string; icon: IconName; color: string }
  | { kind: "clock"; text: string; running: boolean };

export function StatusLine(props: { status: Status; size?: number }) {
  const size = () => props.size ?? 13;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      {props.status.kind === "clock" ? (
        <ClockBadge size={size() + 2} running={props.status.running} />
      ) : (
        <Icon name={props.status.icon} size={size() + 1} color={props.status.color} />
      )}
      <Text style={{ color: WHITE, fontSize: size() }}>{props.status.text}</Text>
    </View>
  );
}

interface Described {
  title: string;
  status: Status;
  progress: number | null;
  message: string | null;
  primary: { title: string; icon: IconName; disabled?: boolean };
  secondary?: boolean;
}

function describe(
  g: Game | undefined,
  props: {
    empty: { title: string; status: string; message: string; action: string };
    hasGames: boolean;
    keysValid: boolean;
    category: Category;
    addFocused: boolean;
  },
): Described {
  // The "Add" tile has focus (keyboard, switch buttons): the info area and Return both map to "Add NSP"
  if (props.addFocused) {
    return {
      title: L("add_game_title"),
      status: { kind: "icon", text: L("home_add_status"), icon: "circle-plus", color: WHITE },
      progress: null,
      message: L("home_add_message"),
      primary: { title: L("menu_add_nsp"), icon: "plus" },
    };
  }
  if (!g) {
    if (!props.hasGames) {
      return {
        title: L("home_welcome_title"),
        status: props.keysValid
          ? { kind: "icon", text: L("home_keys_configured"), icon: "circle-check", color: COLORS.done }
          : { kind: "icon", text: L("home_welcome_keys_step"), icon: "key-round", color: COLORS.active },
        progress: null,
        message: L("home_welcome_message"),
        primary: props.keysValid ? { title: L("menu_add_nsp"), icon: "plus" } : { title: L("home_add_keys"), icon: "key-round" },
        secondary: !props.keysValid,
      };
    }
    const action = props.empty.action;
    const category = CATEGORIES.find((c) => c.id === props.category)!;
    return {
      title: props.empty.title,
      status: { kind: "icon", text: props.empty.status, icon: category.icon as IconName, color: WHITE },
      progress: null,
      message: props.empty.message,
      primary:
        action === "convertAll"
          ? { title: L("menu_convert_all"), icon: "play-fill" }
          : action === "clearSearch"
            ? { title: L("empty_action_clear_search"), icon: "x" }
            : { title: L("empty_action_show_all"), icon: "layout-grid" },
    };
  }

  const state = itemState(g);
  // With updates / DLC, show the components; the size is the sum of all NSPs
  const parts = contents(g).length ? [L("content_kind_base")] : [];
  if (updateOf(g)) parts.push(L("content_kind_update"));
  if (dlcsOf(g).length) parts.push(L("content_dlc_count", dlcsOf(g).length));
  const size = totalSize(g);
  const meta = [g.displayVersion ? `v${g.displayVersion}` : null, parts.length ? parts.join(" + ") : null, native.formatBytes(size)]
    .filter(Boolean)
    .join(" · ");
  const base = { title: g.name, progress: null, message: null } as const;
  switch (state.kind) {
    case "reading":
      return {
        ...base,
        status: { kind: "icon", text: L("home_status_reading", meta), icon: "circle-ellipsis", color: WHITE },
        primary: { title: L("home_action_reading"), icon: "ellipsis", disabled: true },
      };
    case "unreadable":
      return {
        ...base,
        status: { kind: "icon", text: L("home_status_unreadable"), icon: "triangle-alert", color: COLORS.active },
        message: msgText(state.reason),
        primary: { title: L("home_action_delete"), icon: "trash-2" },
      };
    case "pending":
      return {
        ...base,
        status: { kind: "icon", text: L("home_status_pending", meta), icon: "circle-dashed", color: WHITE },
        message: state.missingCover ? L("home_message_no_cover") : null,
        primary: { title: L("action_convert"), icon: "play-fill" },
      };
    case "queued":
      return {
        ...base,
        status: { kind: "clock", text: L("home_status_waiting", meta), running: false },
        primary: { title: L("menu_remove_from_queue"), icon: "x" },
      };
    case "converting": {
      const step = state.step != null ? L("home_status_step", state.step + 1, STEPS.length, STEPS[state.step].title()) : L("home_status_preparing");
      const job = queue.jobFor(g.id);
      const remaining = queue.remainingSeconds(job?.startedAt ?? null, state.progress);
      const text = L("home_status_converting", step) + (remaining != null ? ` · ${L("home_remaining", queue.formatDuration(remaining))}` : "");
      return {
        ...base,
        status: { kind: "clock", text, running: true },
        progress: state.progress,
        primary: { title: L("action_cancel"), icon: "square-fill" },
      };
    }
    case "done": {
      let text = L("home_status_done", meta);
      // Only show the output size when it differs from the original file
      if (state.outputBytes && state.outputBytes !== size) text += ` → ${native.formatBytes(state.outputBytes)}`;
      const changed = contentsChanged(g);
      const exists = nupExists(g) && !changed;
      return {
        ...base,
        status: { kind: "icon", text, icon: "circle-check", color: COLORS.done },
        message: changed ? L("home_message_contents_changed") : state.warning && msgText(state.warning),
        primary: exists ? { title: actions.revealLabel(), icon: "folder-fill" } : { title: L("action_reconvert"), icon: "rotate-cw" },
      };
    }
    case "failed":
      return {
        ...base,
        status: { kind: "icon", text: L("home_status_failed"), icon: "circle-x", color: COLORS.failed },
        message: firstLine(state.reason),
        primary: { title: L("action_retry"), icon: "rotate-cw" },
      };
  }
}
