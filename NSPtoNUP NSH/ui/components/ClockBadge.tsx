// "Converting" clock badge (Switch style): white dial, red minute hand, blue hour hand.
// The hands turn while converting (minute hand 1.2 s per turn, hour hand 14.4 s per turn); while waiting they rest at 10 o'clock.

import { View } from "nsh";

const MINUTE_HAND = "#FF4554";
const HOUR_HAND = "#00C3E3";
const PIN = "#2D2D2D";

function Hand(props: { size: number; length: number; width: number; color: string; rest: number; period: number; running: boolean }) {
  const r = () => props.size / 2;
  return (
    <View
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: props.size,
        height: props.size,
        transform: `rotate(${props.rest}deg)`,
        ...(props.running
          ? { animationName: "spin", animationDuration: props.period, animationIterationCount: "infinite", animationTimingFunction: "linear" }
          : { animationName: "none" }),
      }}
    >
      <View
        style={{
          position: "absolute",
          left: r() - (r() * props.width) / 2,
          top: r() - r() * props.length,
          width: r() * props.width,
          height: r() * props.length + (r() * props.width) / 2,
          borderRadius: (r() * props.width) / 2,
          backgroundColor: props.color,
        }}
      />
    </View>
  );
}

export function ClockBadge(props: { size: number; running: boolean }) {
  const r = () => props.size / 2;
  return (
    <View
      style={{
        width: props.size,
        height: props.size,
        borderRadius: r(),
        backgroundColor: "#FFFFFF",
        borderWidth: Math.max(0.5, r() * 0.05),
        borderColor: "rgba(0,0,0,0.08)",
        boxShadow: "0 1px 3px rgba(0,0,0,0.35)",
      }}
    >
      <Hand size={props.size} length={0.42} width={0.17} color={HOUR_HAND} rest={props.running ? 0 : -60} period={14400} running={props.running} />
      <Hand size={props.size} length={0.64} width={0.13} color={MINUTE_HAND} rest={0} period={1200} running={props.running} />
      <View
        style={{
          position: "absolute",
          left: r() - r() * 0.11,
          top: r() - r() * 0.11,
          width: r() * 0.22,
          height: r() * 0.22,
          borderRadius: r() * 0.11,
          backgroundColor: PIN,
        }}
      />
    </View>
  );
}
