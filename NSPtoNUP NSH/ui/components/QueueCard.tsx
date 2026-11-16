// Conversion queue (⬇ at the top right, console-style floating card): in progress, waiting, recently completed; "Start All / Stop All" at the top,
// "Clear" to the right of the "Recently Completed" header (only hides them from the panel; logs remain viewable).

import { createMotion, Image, Overlay, signal, Text, View, type ViewRef } from "nsh";
import { L } from "../i18n";
import * as actions from "../state/actions";
import { itemState } from "../state/itemState";
import { coverUrl, game as findGame, games, iconUrl, type Game } from "../state/library";
import * as queue from "../state/queue";
import { STEPS } from "../state/steps";
import { focusGame, queueOpen } from "../state/ui";
import { CapsuleButton, COLORS, Icon, Panel, ProgressBar, RoundButton, white, WHITE } from "./controls";
import { StatusLine, type Status } from "./Home";
import type { IconName } from "./icons";

export function QueueCard(props: { anchor: ViewRef | undefined }) {
  const motion = createMotion({ enter: "fadeInDown", duration: 200 });
  const active = () => queue.jobs().map((j) => findGame(j.gameId)).filter((g): g is Game => !!g);
  const recent = () =>
    queue
      .recentJobs()
      .slice(0, 5)
      .map((j) => findGame(j.gameId))
      .filter((g): g is Game => !!g);
  const close = () => queueOpen.set(false);

  return (
    <Overlay
      anchor={props.anchor}
      placement="bottom"
      align="end"
      offset={8}
      margin={12}
      onPressOutside={close}
      onCancel={close}
      style={motion.style}
    >
      <Panel style={{ width: 380, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8, paddingHorizontal: 4 }}>
          <Text style={{ color: WHITE, fontSize: 16, fontWeight: "700", flex: 1 }}>{L("queue_title")}</Text>
          {queue.isRunning() ? (
            <CapsuleButton title={L("action_stop_all")} onPress={() => actions.stopAll()} />
          ) : (
            <CapsuleButton
              title={queue.pendingGames().length > 0 ? L("queue_start_all_count", queue.pendingGames().length) : L("queue_start_all")}
              disabled={queue.pendingGames().length === 0}
              onPress={() => actions.convertAll()}
            />
          )}
        </View>
        <If when={!active().length && !recent().length}>
          <Text style={{ color: white(0.5), fontSize: 13, paddingVertical: 18, textAlign: "center" }}>{L("queue_empty")}</Text>
        </If>
        <Each of={active()} key={(g) => g.id}>
          {(g) => <QueueRow id={g().id} />}
        </Each>
        <If when={active().length > 0 && recent().length > 0}>
          <View style={{ height: 1, marginHorizontal: 8, marginVertical: 4, backgroundColor: white(0.1) }} />
        </If>
        <If when={recent().length > 0}>
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 4, paddingTop: 4, paddingBottom: 2 }}>
            <Text style={{ color: white(0.6), fontSize: 12, fontWeight: "600", flex: 1 }}>{L("queue_recent")}</Text>
            <ExpandingButton icon="x" title={L("queue_clear")} hint={L("queue_clear_tooltip")} onPress={queue.clearRecent} />
          </View>
        </If>
        <Each of={recent()} key={(g) => g.id}>
          {(g) => <QueueRow id={g().id} />}
        </Each>
      </Panel>
    </Overlay>
  );
}

/// A queue row: icon | name + status (+ progress bar) | actions
function QueueRow(props: { id: string }) {
  const g = () => games().find((x) => x.id === props.id);
  const row = () => {
    const value = g();
    if (!value) return null;
    const job = queue.jobFor(value.id) ?? queue.history()[value.id];
    const state = itemState(value);
    let status: Status;
    let action: { icon: IconName; hint: string };
    let progress: number | null = null;
    if (state.kind === "converting") {
      status = { kind: "clock", text: `${state.step != null ? STEPS[state.step].title() : L("home_status_preparing")} · ${Math.floor(state.progress * 100)}%`, running: true };
      action = { icon: "square-fill", hint: L("action_stop_conversion") };
      progress = state.progress;
    } else if (state.kind === "queued") {
      status = { kind: "clock", text: L("status_waiting"), running: false };
      action = { icon: "x", hint: L("menu_remove_from_queue") };
    } else if (job?.state() === "cancelled") {
      status = { kind: "icon", text: L("status_cancelled"), icon: "circle-x", color: white(0.6) };
      action = { icon: "play-fill", hint: L("action_convert") };
    } else if (state.kind === "done") {
      status = { kind: "icon", text: L("status_done"), icon: "circle-check", color: COLORS.done };
      action = { icon: "folder-fill", hint: actions.revealLabel() };
    } else {
      status = { kind: "icon", text: L("status_failed"), icon: "circle-x", color: COLORS.failed };
      action = { icon: "rotate-cw", hint: L("action_retry") };
    }
    return { value, status, action, progress };
  };
  return (
    <If when={row()}>
      {(r) => (
        <View
          onPress={() => {
            focusGame.set(props.id);
            queueOpen.set(false);
          }}
          style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 4, paddingVertical: 8, borderRadius: 10 }}
          hoverStyle={{ backgroundColor: white(0.06) }}
        >
          <View style={{ width: 40, height: 40, borderRadius: 8, overflow: "hidden", backgroundColor: white(0.1) }}>
            <If when={iconUrl(r().value) ?? coverUrl(r().value)}>
              {(src) => <Image src={src()} style={{ width: 40, height: 40, objectFit: "cover" }} />}
            </If>
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: WHITE, fontSize: 13, fontWeight: "500", numberOfLines: 1 }}>{r().value.name}</Text>
            <StatusLine status={r().status} size={12} />
            <If when={r().progress != null}>
              <ProgressBar value={r().progress ?? 0} width="100%" height={5} />
            </If>
          </View>
          <RoundButton icon={r().action.icon} hint={r().action.hint} size={30} onPress={() => actions.primaryAction(r().value)} />
        </View>
      )}
    </If>
  );
}



/// Expandable round button (like "Clear" in macOS Notification Center): normally a round icon button,
/// on hover it expands leftward into an "icon + text" capsule, and collapses when the pointer leaves
function ExpandingButton(props: { icon: IconName; title: string; hint: string; onPress: () => void }) {
  const hovering = signal(false);
  const size = 30;
  return (
    <View
      role="button"
      accessibilityLabel={props.title}
      accessibilityHint={props.hint}
      onPress={props.onPress}
      onMouseEnter={() => hovering.set(true)}
      onMouseLeave={() => hovering.set(false)}
      style={{
        height: size,
        borderRadius: size / 2,
        flexDirection: "row",
        alignItems: "center",
        paddingLeft: (size - 13) / 2,
        paddingRight: hovering() ? 12 : (size - 13) / 2,
        gap: hovering() ? 6 : 0,
        backgroundColor: white(hovering() ? 0.22 : 0.12),
        borderWidth: 1,
        borderColor: white(0.18),
      }}
      activeStyle={{ backgroundColor: white(0.32) }}
    >
      <Icon name={props.icon} size={13} />
      <If when={hovering()}>
        <Text style={{ color: WHITE, fontSize: 12, fontWeight: "500", ...createMotion({ enter: "fadeIn", duration: 150 }).style }}>
          {props.title}
        </Text>
      </If>
    </View>
  );
}
