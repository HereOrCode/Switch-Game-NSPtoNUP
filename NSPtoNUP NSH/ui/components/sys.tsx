// System-style controls used by sheets, in the style of the macOS standard controls (dark appearance):
// sheet shell, buttons (default button is blue), text fields, segmented control, toggle, checkbox, pop-up button, grouped list, separator.
// The main screen still uses the console-style controls in controls.tsx.

import { Image, Text, View, windowSize, type JSX, type ViewRef } from "nsh";
import { Dialog, Input } from "nsh/base";
import { ClockBadge } from "./ClockBadge";
import { icons, type IconName } from "./icons";

export const SYS = {
  sheet: "#262628",
  /// Background for groups, lists and the log box
  well: "rgba(255,255,255,0.04)",
  border: "rgba(255,255,255,0.12)",
  separator: "rgba(255,255,255,0.1)",
  text: "#FFFFFF",
  secondary: "rgba(235,235,245,0.6)",
  tertiary: "rgba(235,235,245,0.35)",
  accent: "#0A84FF",
  green: "#30D158",
  orange: "#FF9F0A",
  red: "#FF453A",
  button: "rgba(255,255,255,0.14)",
};

/// Sheet size: 85% of the main window, no smaller than the minimum and no larger than the main window
export function sheetSize(min = { width: 640, height: 460 }) {
  const w = windowSize();
  return {
    width: Math.min(Math.max(w.width * 0.85, min.width), w.width - 40),
    height: Math.min(Math.max(w.height * 0.85, min.height), w.height - 40),
  };
}

/// Sheet attached to the main window: dims the background, Esc closes (onCancel). Clicking the background doesn't close it, per HIG
export function Sheet(props: {
  open: boolean;
  onCancel: () => void;
  width: number;
  height?: number;
  label?: string;
  children?: JSX.Element;
}) {
  return (
    <Dialog
      open={props.open}
      animation="fade"
      accessibilityLabel={props.label}
      closeOnBackdropPress={false}
      closeOnEscape={false}
      onCancel={() => props.onCancel()}
      backdropStyle={{ backgroundColor: "rgba(0,0,0,0.42)" }}
      style={{ flex: 1, alignItems: "center", justifyContent: "center", pointerEvents: "box-none" }}
    >
      <View
        style={{
          width: props.width,
          height: props.height,
          maxWidth: "96%",
          maxHeight: "96%",
          backgroundColor: SYS.sheet,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.16)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
          overflow: "hidden",
        }}
      >
        {props.children}
      </View>
    </Dialog>
  );
}

/// Sheet title row
export function SheetTitle(props: { title: string; trailing?: JSX.Element }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline", paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 }}>
      <Text style={{ color: SYS.text, fontSize: 15, fontWeight: "600", flex: 1, numberOfLines: 1 }}>{props.title}</Text>
      {props.trailing}
    </View>
  );
}

export function Separator(props: { inset?: number }) {
  return <View style={{ height: 1, backgroundColor: SYS.separator, marginHorizontal: props.inset ?? 0 }} />;
}

/// Sheet bottom button row
export function SheetButtons(props: { children?: JSX.Element }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 14 }}>
      {props.children}
    </View>
  );
}

export function SysIcon(props: { name: IconName; size?: number; color?: string }) {
  return (
    <Image src={icons[props.name]} style={{ width: props.size ?? 14, height: props.size ?? 14, tintColor: props.color ?? SYS.text }} />
  );
}

/// Button: regular (gray) or default (blue, Return); small for the small size
export function Button(props: {
  title: string;
  onPress: (e: { ref?: ViewRef }) => void;
  primary?: boolean;
  disabled?: boolean;
  small?: boolean;
  destructive?: boolean;
  trailingIcon?: IconName;
  minWidth?: number;
  testID?: string;
}) {
  let node: ViewRef | undefined;
  const bg = () => (props.primary ? SYS.accent : SYS.button);
  return (
    <View
      ref={node}
      role="button"
      testID={props.testID}
      accessibilityLabel={props.title}
      accessibilityState={{ disabled: !!props.disabled }}
      onPress={() => !props.disabled && props.onPress({ ref: node })}
      style={{
        height: props.small ? 22 : 28,
        minWidth: props.minWidth ?? (props.small ? 0 : 84),
        paddingHorizontal: props.small ? 10 : 14,
        borderRadius: props.small ? 5 : 7,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        backgroundColor: bg(),
        opacity: props.disabled ? 0.4 : 1,
        boxShadow: "0 0.5px 1px rgba(0,0,0,0.3)",
      }}
      hoverStyle={props.disabled ? undefined : { backgroundColor: props.primary ? "#2B95FF" : "rgba(255,255,255,0.2)" }}
      activeStyle={props.disabled ? undefined : { backgroundColor: props.primary ? "#0070E0" : "rgba(255,255,255,0.28)" }}
    >
      <Text
        style={{
          color: props.destructive ? SYS.red : SYS.text,
          fontSize: props.small ? 12 : 13,
          fontWeight: props.primary ? "600" : "500",
        }}
      >
        {props.title}
      </Text>
      <If when={props.trailingIcon}>{(name) => <SysIcon name={name()} size={11} color={SYS.secondary} />}</If>
    </View>
  );
}

/// Text field (rounded border)
export function TextField(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Input
      testID={props.testID}
      value={props.value}
      placeholder={props.placeholder}
      readonly={props.disabled}
      autoCorrect={false}
      onChange={({ value }) => props.onChange(value)}
      style={{
        flex: 1,
        height: 26,
        paddingHorizontal: 8,
        borderRadius: 6,
        fontSize: 13,
        color: props.disabled ? SYS.tertiary : SYS.text,
        backgroundColor: "rgba(255,255,255,0.05)",
        borderWidth: 1,
        borderColor: SYS.border,
      }}
      focusStyle={{ borderColor: SYS.accent }}
    />
  );
}

/// Segmented control (Settings categories)
export function Segmented(props: { items: string[]; selected: number; onChange: (index: number) => void }) {
  return (
    <View style={{ flexDirection: "row", padding: 2, borderRadius: 7, backgroundColor: "rgba(255,255,255,0.08)", alignSelf: "center" }}>
      <Each of={props.items}>
        {(item, index) => (
          <View
            role="tab"
            accessibilityState={{ selected: props.selected === index() }}
            onPress={() => props.onChange(index())}
            style={{
              width: 100,
              height: 26,
              borderRadius: 6,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: props.selected === index() ? SYS.accent : "transparent",
            }}
          >
            <Text style={{ color: SYS.text, fontSize: 13, fontWeight: props.selected === index() ? "600" : "400" }}>{item()}</Text>
          </View>
        )}
      </Each>
    </View>
  );
}

/// Toggle: blue when on (NSSwitch)
export function Switch(props: { on: boolean; onChange: (on: boolean) => void; label?: string; testID?: string }) {
  return (
    <View
      role="switch"
      testID={props.testID}
      accessibilityLabel={props.label}
      accessibilityState={{ checked: props.on }}
      onPress={() => props.onChange(!props.on)}
      style={{
        width: 38,
        height: 22,
        borderRadius: 11,
        padding: 2,
        backgroundColor: props.on ? SYS.accent : "rgba(255,255,255,0.16)",
        transitionProperty: "colors",
        transitionDuration: 180,
      }}
    >
      <View
        style={{
          width: 18,
          height: 18,
          borderRadius: 9,
          backgroundColor: "#ECECEC",
          boxShadow: "0 1px 2px rgba(0,0,0,0.35)",
          transform: [{ translateX: props.on ? 16 : 0 }],
          transitionProperty: "transform",
          transitionDuration: 180,
          transitionTimingFunction: "ease-out",
        }}
      />
    </View>
  );
}

/// Checkbox (optionally with a label)
export function Checkbox(props: { checked: boolean; onChange: (checked: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <View
      role="checkbox"
      accessibilityLabel={props.label}
      accessibilityState={{ checked: props.checked, disabled: !!props.disabled }}
      onPress={() => !props.disabled && props.onChange(!props.checked)}
      style={{ flexDirection: "row", alignItems: "center", gap: 7, opacity: props.disabled ? 0.4 : 1 }}
    >
      <View
        style={{
          width: 15,
          height: 15,
          borderRadius: 4,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: props.checked ? SYS.accent : "rgba(255,255,255,0.1)",
          borderWidth: props.checked ? 0 : 1,
          borderColor: "rgba(255,255,255,0.25)",
        }}
      >
        <If when={props.checked}>
          <SysIcon name="check" size={11} color="#FFFFFF" />
        </If>
      </View>
      <If when={props.label}>{(label) => <Text style={{ color: SYS.text, fontSize: 13 }}>{label()}</Text>}</If>
    </View>
  );
}

/// Small status note: icon (or spinning clock) + text
export type StatusInfo = { text: string; icon?: IconName; color?: string; clock?: boolean };

export function Status(props: { status: StatusInfo; size?: number; textColor?: string }) {
  const size = () => props.size ?? 12;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 1 }}>
      {props.status.clock ? (
        <ClockBadge size={size() + 2} running />
      ) : (
        <SysIcon name={props.status.icon ?? "circle-dashed"} size={size() + 1} color={props.status.color ?? SYS.tertiary} />
      )}
      <Text style={{ color: props.textColor ?? SYS.secondary, fontSize: size(), numberOfLines: 1, flexShrink: 1 }}>{props.status.text}</Text>
    </View>
  );
}

/// Group box: rounded light background with separators between rows (rows supplied by the caller via GroupRow)
export function Group(props: { children?: JSX.Element; style?: any }) {
  return (
    <View
      style={[
        { borderRadius: 10, borderWidth: 1, borderColor: SYS.border, backgroundColor: SYS.well, overflow: "hidden" },
        props.style,
      ]}
    >
      {props.children}
    </View>
  );
}

/// Settings row: title and description on the left, control on the right; first marks the group's first row (no separator above)
export function GroupRow(props: { title: string; note?: string; first?: boolean; children?: JSX.Element }) {
  return (
    <View>
      <If when={!props.first}>
        <Separator inset={14} />
      </If>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 10, minHeight: 52 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: SYS.text, fontSize: 13, fontWeight: "500" }}>{props.title}</Text>
          <If when={props.note}>
            {(note) => <Text style={{ color: SYS.secondary, fontSize: 11, numberOfLines: 2, textOverflow: "ellipsis-middle" }}>{note()}</Text>}
          </If>
        </View>
        {props.children}
      </View>
    </View>
  );
}

/// Section header (mid-sheet content)
export function SectionTitle(props: { title: string; trailing?: JSX.Element }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 22 }}>
      <Text style={{ color: SYS.text, fontSize: 13, fontWeight: "600" }}>{props.title}</Text>
      {props.trailing}
    </View>
  );
}
