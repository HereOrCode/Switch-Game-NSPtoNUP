// Console-style controls: white capsule primary button, translucent round buttons, underlined category tabs, translucent rounded buttons, toggles, tooltips.
// These controls sit on top of images, so they always use a white palette.

import { Image, Text, View, type JSX, type ViewRef } from "nsh";
import { Switch, Tooltip } from "nsh/base";
import { icons, type IconName } from "./icons";

export const WHITE = "#FFFFFF";
export const white = (alpha: number) => `rgba(255,255,255,${alpha})`;
export const black = (alpha: number) => `rgba(0,0,0,${alpha})`;
/// Soft white for progress bars and badges
export const FILL = "#EDEDF2";
export const COLORS = {
  done: "#30D158",
  active: "#FF9F0A",
  failed: "#FF453A",
  accent: "#0A84FF",
};
/// Panel background
export const PANEL = "rgba(23,23,28,0.96)";

export function Icon(props: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  return (
    <Image
      src={icons[props.name]}
      style={{ width: props.size ?? 16, height: props.size ?? 16, tintColor: props.color ?? WHITE }}
    />
  );
}

/// Console-style tooltip: small dark rounded label
export function Hint(props: { text: string; placement?: "top" | "bottom" }) {
  return (
    <Tooltip
      placement={props.placement ?? "bottom"}
      class="transition-opacity duration-100"
      startingClass="opacity-0"
      endingClass="opacity-0"
      style={{
        backgroundColor: PANEL,
        borderRadius: 7,
        borderWidth: 1,
        borderColor: white(0.12),
        paddingHorizontal: 10,
        paddingVertical: 5,
      }}
    >
      <Text style={{ color: WHITE, fontSize: 12, fontWeight: "500" }}>{props.text}</Text>
    </Tooltip>
  );
}

/// White capsule primary button: icon + text
export function PillButton(props: {
  title: string;
  icon: IconName;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <View
      role="button"
      testID={props.testID}
      onPress={() => !props.disabled && props.onPress()}
      accessibilityLabel={props.title}
      style={{
        height: 44,
        borderRadius: 22,
        paddingHorizontal: 26,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        backgroundColor: white(0.92),
        opacity: props.disabled ? 0.4 : 1,
      }}
      hoverStyle={props.disabled ? undefined : { backgroundColor: WHITE }}
      activeStyle={props.disabled ? undefined : { backgroundColor: white(0.75) }}
    >
      <Icon name={props.icon} size={15} color="#000000" />
      <Text style={{ color: "#000000", fontSize: 15, fontWeight: "600" }}>{props.title}</Text>
    </View>
  );
}

/// Translucent round icon button; shows a count in the top-right when badge > 0
export function RoundButton(props: {
  icon: IconName;
  hint: string;
  onPress: (e: { ref?: ViewRef }) => void;
  size?: number;
  badge?: number;
  tint?: string;
  disabled?: boolean;
  ref?: (node: ViewRef) => void;
  testID?: string;
}) {
  let node: ViewRef | undefined;
  const size = () => props.size ?? 40;
  return (
    <View
      ref={(n: ViewRef) => {
        node = n;
        props.ref?.(n);
      }}
      role="button"
      testID={props.testID}
      accessibilityLabel={props.hint}
      onPress={() => !props.disabled && props.onPress({ ref: node })}
      tooltip={<Hint text={props.hint} />}
      style={{
        width: size(),
        height: size(),
        borderRadius: size() / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: white(0.12),
        borderWidth: 1,
        borderColor: white(0.18),
        opacity: props.disabled ? 0.4 : 1,
      }}
      hoverStyle={props.disabled ? undefined : { backgroundColor: white(0.22) }}
      activeStyle={props.disabled ? undefined : { backgroundColor: white(0.32) }}
    >
      <Icon name={props.icon} size={Math.round(size() * 0.42)} color={props.tint ?? WHITE} />
      <If when={(props.badge ?? 0) > 0}>
        <View
          style={{
            position: "absolute",
            top: -4,
            right: -4,
            minWidth: 16,
            height: 16,
            borderRadius: 8,
            paddingHorizontal: 4,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: FILL,
          }}
        >
          <Text style={{ color: "#000000", fontSize: 10, fontWeight: "700" }}>{String(props.badge)}</Text>
        </View>
      </If>
    </View>
  );
}

/// Category tab: icon + text + count; when selected the text is white with an underline
export function TabButton(props: {
  title: string;
  icon: IconName;
  count: number;
  selected: boolean;
  onPress: () => void;
  hint?: string;
}) {
  const color = () => white(props.selected ? 1 : 0.6);
  return (
    <View
      role="tab"
      class="group"
      accessibilityState={{ selected: props.selected }}
      onPress={props.onPress}
      tooltip={props.hint ? <Hint text={props.hint} /> : undefined}
      style={{ height: 30, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 2 }}
    >
      <Icon name={props.icon} size={15} color={color()} />
      <Text style={{ color: color(), fontSize: 15, fontWeight: props.selected ? "600" : "500" }}>{props.title}</Text>
      <If when={props.count > 0}>
        <Text style={{ color: white(props.selected ? 0.6 : 0.36), fontSize: 13, fontVariant: ["tabular-nums"] }}>
          {String(props.count)}
        </Text>
      </If>
      <View
        style={{
          position: "absolute",
          left: 2,
          right: 2,
          bottom: -4,
          height: 2.5,
          borderRadius: 1.25,
          backgroundColor: WHITE,
          opacity: props.selected ? 1 : 0,
        }}
      />
    </View>
  );
}

/// Translucent rounded button for secondary actions ("Change…", etc.); trailingIcon is for dropdown menus
export function CapsuleButton(props: {
  title: string;
  onPress: (e: { ref?: ViewRef }) => void;
  trailingIcon?: IconName;
  disabled?: boolean;
  primary?: boolean;
  testID?: string;
}) {
  let node: ViewRef | undefined;
  return (
    <View
      ref={node}
      role="button"
      testID={props.testID}
      onPress={() => !props.disabled && props.onPress({ ref: node })}
      style={{
        height: 30,
        paddingHorizontal: 14,
        borderRadius: 8,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        backgroundColor: props.primary ? COLORS.accent : white(0.12),
        borderWidth: 1,
        borderColor: props.primary ? "transparent" : white(0.18),
        opacity: props.disabled ? 0.4 : 1,
      }}
      hoverStyle={props.disabled ? undefined : { backgroundColor: props.primary ? "#2994FF" : white(0.22) }}
      activeStyle={props.disabled ? undefined : { backgroundColor: props.primary ? "#0070E0" : white(0.32) }}
    >
      <Text style={{ color: WHITE, fontSize: 13, fontWeight: "500" }}>{props.title}</Text>
      <If when={props.trailingIcon}>{(name) => <Icon name={name()} size={11} color={white(0.7)} />}</If>
    </View>
  );
}

/// Toggle: soft white track + dark knob when on, translucent track + white knob when off
export function Toggle(props: { on: boolean; onChange: (on: boolean) => void; label?: string; testID?: string }) {
  return (
    <Switch
      checked={props.on}
      testID={props.testID}
      accessibilityLabel={props.label}
      onChange={({ checked }) => props.onChange(checked)}
      trackStyle={{
        width: 42,
        height: 24,
        borderRadius: 12,
        padding: 2,
        backgroundColor: props.on ? white(0.85) : white(0.18),
        transitionProperty: "colors",
        transitionDuration: 180,
      }}
      thumbStyle={{
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: props.on ? "rgb(26,26,26)" : "rgb(230,230,230)",
        transform: [{ translateX: props.on ? 18 : 0 }],
        transitionProperty: "transform, colors",
        transitionDuration: 180,
        transitionTimingFunction: "ease-out",
      }}
    />
  );
}

/// Panel look: dark translucent background + thin border, corner radius matching the main window
export function Panel(props: { children?: JSX.Element; style?: any; class?: string }) {
  return (
    <View
      class={props.class}
      style={[
        {
          backgroundColor: PANEL,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: white(0.1),
          boxShadow: "0 18px 50px rgba(0,0,0,0.55)",
        },
        props.style,
      ]}
    >
      {props.children}
    </View>
  );
}

/// Thin progress bar
export function ProgressBar(props: { value: number; width?: number | `${number}%`; height?: number; animated?: boolean }) {
  const height = () => props.height ?? 8;
  return (
    <View
      style={{
        width: props.width ?? 360,
        height: height(),
        borderRadius: height() / 2,
        backgroundColor: white(0.18),
        overflow: "hidden",
      }}
    >
      <View
        style={{
          width: "100%",
          height: "100%",
          borderRadius: height() / 2,
          backgroundColor: FILL,
          transformOrigin: "left",
          transform: [{ scaleX: Math.min(Math.max(props.value, 0), 1) }],
          transitionProperty: props.animated === false ? "none" : "transform",
          transitionDuration: 600,
          transitionTimingFunction: "ease-out",
        }}
      />
    </View>
  );
}
