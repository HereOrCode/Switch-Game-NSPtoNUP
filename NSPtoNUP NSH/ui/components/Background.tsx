// Full-screen background: the selected game's 16:9 cover fills the window. Switching fades and slightly scales;
// gradients darken the top, left and bottom so white text stays readable.
// Without a cover, the square icon is enlarged and blurred; with neither, a dark gradient matching the App icon is used.

import { createMotion, effect, Image, signal, untracked, View } from "nsh";
import emptyBackground from "../../assets/empty-background.jpg";

export interface BackgroundImage {
  /// Don't re-animate for the same key
  key: string;
  cover: string | null;
  icon: string | null;
  /// Fixed background when there are no games
  empty?: boolean;
}

function Layer(props: { image: BackgroundImage; animate: boolean }) {
  const motion = createMotion(
    props.animate ? { initial: { opacity: 0, scale: 1.04 } } : {},
  );
  if (props.animate) {
    // Fade in during the first half; ease from 1.04 back to 1.0 for a more layered transition
    motion.play({
      duration: 900,
      keyframes: [
        { opacity: 0, scale: 1.04, easing: "easeInOut" },
        { opacity: 1, scale: 1.012, offset: 0.5, easing: "easeOut" },
        { opacity: 1, scale: 1 },
      ],
    });
  }
  const src = () => (props.image.empty ? emptyBackground : props.image.cover ?? props.image.icon);
  return (
    <View style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, ...motion.style }}>
      <If when={src()}>
        {(source) => (
          <Image
            src={source()}
            blurRadius={!props.image.empty && !props.image.cover ? 40 : 0}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        )}
      </If>
    </View>
  );
}

export function Background(props: { image: BackgroundImage }) {
  // Keep at most two layers: the new one fades in on top, then the old one is removed
  const layers = signal<{ image: BackgroundImage; animate: boolean }[]>([{ image: props.image, animate: false }]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const show = (image: BackgroundImage) => {
    const list = layers();
    if (list[list.length - 1]?.image.key === image.key) return;
    layers.set([...list.slice(-1), { image, animate: true }]);
    clearTimeout(timer);
    timer = setTimeout(() => layers.set(layers().slice(-1)), 950);
  };
  // Follow the selected game
  effect(() => {
    const image = props.image;
    untracked(() => show(image));
  });
  return (
    <View
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        overflow: "hidden",
        backgroundColor: "#000000",
        backgroundImage: "linear-gradient(to bottom right, #2B2A6B, #14122E, #07070F)",
      }}
    >
      <Each of={layers()} key={(layer) => layer.image.key + (layer.animate ? ":a" : "")}>
        {(layer) => <Layer image={layer().image} animate={layer().animate} />}
      </Each>
      {/* Darken the top more: real covers often have awards or text in the top-right that clash with the top bar and categories */}
      <View
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          right: 0,
          bottom: 0,
          backgroundImage: "linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.6) 32%, rgba(0,0,0,0) 60%)",
        }}
      />
      <View
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          right: 0,
          bottom: 0,
          backgroundImage: "linear-gradient(to right, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0) 60%)",
        }}
      />
      <View
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          right: 0,
          bottom: 0,
          backgroundImage: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0) 55%)",
        }}
      />
    </View>
  );
}
