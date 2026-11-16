// Horizontal game carousel: square icons; the selected tile is enlarged with a white border, and the list scrolls smoothly to keep it near the left.
//
// Every tile is laid out at the selected size, then positioned with a transform (translate + scale):
// the system interpolates transform transitions per frame, so rapid switching or reversing mid-way continues smoothly from the current position.
// Tiles have no tooltip: tooltips are positioned by layout position (not the transformed one) and would show under other tiles.

import { effect, Image, signal, untracked, View, windowSize, type JSX } from "nsh";
import { L } from "../i18n";
import { ClockBadge } from "./ClockBadge";
import { black, FILL, Hint, Icon, white, WHITE } from "./controls";

export const TILE = 116;
export const SELECTED = 148;
const SPACING = 18;
const LEADING = 40;
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

export type CarouselItem = { kind: "game"; id: string } | { kind: "add" };

export interface TileInfo {
  image: string | null;
  name: string;
  /// Progress while converting
  progress: number | null;
  clock: "running" | "waiting" | null;
}

export function Carousel(props: {
  items: CarouselItem[];
  /// Selected game; the "Add" tile never takes part in selection (it is always last)
  selected: number;
  /// The "Add" tile has focus: enlarged like the selected game (without the white border)
  addFocused: boolean;
  tile: (id: string) => TileInfo;
  onSelect: (index: number) => void;
  /// Switch buttons: move between games; after the last game comes the "Add" tile
  onMove: (delta: number) => void;
  onAdd: () => void;
  onMenu: (index: number, at: { x: number; y: number }) => void;
}) {
  const hovering = signal(false);
  /// Offset from manual trackpad / scroll-wheel scrolling; returns to the automatic position when the selection changes
  const manualOffset = signal<number | null>(null);
  const gameCount = () => props.items.filter((i) => i.kind === "game").length;
  const hasAdd = () => props.items.some((i) => i.kind === "add");
  /// The enlarged tile: the selected game, or the focused "Add" tile
  const enlarged = () => (props.addFocused ? gameCount() : props.selected);
  // Return to the automatic position when the selection changes
  effect(() => {
    enlarged();
    untracked(() => manualOffset.set(null));
  });

  const pitch = TILE + SPACING;
  const maxOffset = () => {
    const content = props.items.length * pitch + (SELECTED - TILE) + LEADING * 2;
    return Math.max(content - windowSize().width, 0);
  };
  const clamp = (value: number) => Math.min(Math.max(value, 0), maxOffset());
  /// The selected tile (or focused "Add" tile) rests in the second slot (one tile before it); the first few items don't scroll
  const autoOffset = () => clamp((enlarged() - 1) * pitch);
  const offset = () => {
    const manual = manualOffset();
    return manual != null ? clamp(manual) : autoOffset();
  };
  const x = (index: number) => LEADING - offset() + index * pitch + (index > enlarged() ? SELECTED - TILE : 0);

  return (
    <View
      style={{ height: SELECTED + 12 }}
      onMouseEnter={() => hovering.set(true)}
      onMouseLeave={() => hovering.set(false)}
      onWheel={(e: any) => {
        const dx = Math.abs(e.delta.x) > Math.abs(e.delta.y) ? e.delta.x : e.delta.y;
        const scale = e.deltaMode === "lines" ? 12 : 1;
        manualOffset.set(clamp((manualOffset() ?? autoOffset()) + dx * scale));
      }}
    >
      <Each of={props.items} key={(item) => (item.kind === "add" ? "add" : item.id)}>
        {(item, index) => {
          const isAdd = item().kind === "add";
          const selected = () => !isAdd && !props.addFocused && index() === props.selected;
          const scale = () => (index() === enlarged() && (isAdd ? props.addFocused : selected()) ? 1 : TILE / SELECTED);
          return (
            <View
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: SELECTED,
                height: SELECTED,
                transformOrigin: "top left",
                transform: [{ translateX: x(index()) }, { scale: scale() }],
                transitionProperty: "transform",
                transitionDuration: 280,
                transitionTimingFunction: EASE,
              }}
            >
              {(() => {
                const value = item();
                return value.kind === "add" ? (
                  <AddTile onPress={props.onAdd} focused={props.addFocused} />
                ) : (
                  <GameTile
                    info={props.tile(value.id)}
                    selected={selected()}
                    // Double-click: not handled yet (the first click already selected it), reserved for future features
                    onPress={() => props.onSelect(index())}
                    onMenu={(at) => {
                      props.onSelect(index());
                      props.onMenu(index(), at);
                    }}
                  />
                );
              })()}
            </View>
          );
        }}
      </Each>
      <Arrow
        side="left"
        shown={hovering() && (props.addFocused ? gameCount() > 0 : props.selected > 0)}
        onPress={() => props.onMove(-1)}
      />
      <Arrow
        side="right"
        shown={hovering() && !props.addFocused && (props.selected < gameCount() - 1 || hasAdd())}
        onPress={() => props.onMove(1)}
      />
    </View>
  );
}

/// Round switch buttons on either side of the carousel: dark translucent background stays clear over images; show/hide fades with a slight scale
function Arrow(props: { side: "left" | "right"; shown: boolean; onPress: () => void }) {
  const size = 44;
  return (
    <View
      role="button"
      accessibilityLabel={props.side === "left" ? L("carousel_previous_label") : L("carousel_next_label")}
      onPress={props.onPress}
      tooltip={<Hint text={props.side === "left" ? L("carousel_previous") : L("carousel_next")} />}
      style={{
        position: "absolute",
        pointerEvents: props.shown ? "auto" : "none",
        top: (SELECTED - size) / 2,
        [props.side]: 12,
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: black(0.65),
        borderWidth: 1,
        borderColor: white(0.18),
        boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
        opacity: props.shown ? 1 : 0,
        scale: props.shown ? 1 : 0.85,
        transitionProperty: "opacity, transform",
        transitionDuration: props.shown ? 220 : 180,
        transitionTimingFunction: "ease-out",
      }}
      hoverStyle={{ backgroundColor: "rgba(40,40,46,0.85)" }}
    >
      <Icon name={props.side === "left" ? "chevron-left" : "chevron-right"} size={20} />
    </View>
  );
}

function TileFrame(props: { children?: JSX.Element; shadow?: boolean }) {
  return (
    <View
      style={{
        width: SELECTED,
        height: SELECTED,
        borderRadius: SELECTED * 0.12,
        boxShadow: props.shadow === false ? undefined : "0 6px 12px rgba(0,0,0,0.45)",
      }}
    >
      {props.children}
    </View>
  );
}

function GameTile(props: {
  info: TileInfo;
  selected: boolean;
  onPress: () => void;
  onMenu: (at: { x: number; y: number }) => void;
}) {
  const radius = SELECTED * 0.12;
  return (
    <View
      role="button"
      accessibilityLabel={props.info.name}
      accessibilityState={{ selected: props.selected }}
      onPress={props.onPress}
      onContextMenu={(e: any) => props.onMenu(e.pagePosition)}
    >
      <TileFrame>
        <View style={{ width: "100%", height: "100%", borderRadius: radius, overflow: "hidden", backgroundColor: white(0.1) }}>
          <If
            when={props.info.image}
            else={
              <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                <Icon name="gamepad-2" size={38} color={white(0.5)} />
              </View>
            }
          >
            {(src) => <Image src={src()} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
          </If>
          {/* Converting: thin progress bar at the bottom */}
          <If when={props.info.progress != null}>
            <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 6, backgroundColor: black(0.45) }}>
              <View
                style={{
                  width: `${Math.round((props.info.progress ?? 0) * 1000) / 10}%`,
                  height: "100%",
                  backgroundColor: FILL,
                }}
              />
            </View>
          </If>
        </View>
        {/* Clock badge: turns while converting, still while waiting */}
        <If when={props.info.clock}>
          {(clock) => (
            <View style={{ position: "absolute", right: 8, bottom: 14 }}>
              <ClockBadge size={24} running={clock() === "running"} />
            </View>
          )}
        </If>
        {/* Selected: white border */}
        <View
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
            borderRadius: radius,
            borderWidth: 3.5,
            borderColor: WHITE,
            opacity: props.selected ? 1 : 0,
            transitionProperty: "opacity",
            transitionDuration: 200,
          }}
        />
      </TileFrame>
    </View>
  );
}

/// "Add" tile: dashed border + plus sign; click it or drag files into the window to add.
/// Never selected; brightens on hover or focus (keyboard, switch buttons)
function AddTile(props: { onPress: () => void; focused: boolean }) {
  const hovering = signal(false);
  const lit = () => hovering() || props.focused;
  return (
    <View
      role="button"
      accessibilityLabel={L("carousel_add_label")}
      onPress={props.onPress}
      onMouseEnter={() => hovering.set(true)}
      onMouseLeave={() => hovering.set(false)}
      style={{
        width: SELECTED,
        height: SELECTED,
        borderRadius: SELECTED * 0.12,
        borderWidth: 1.5,
        borderStyle: "dashed",
        borderColor: white(lit() ? 0.85 : 0.5),
        backgroundColor: white(lit() ? 0.12 : 0.06),
        alignItems: "center",
        justifyContent: "center",
        transitionProperty: "colors",
        transitionDuration: 150,
      }}
    >
      <Icon name="plus" size={38} color={white(lit() ? 1 : 0.8)} />
    </View>
  );
}
