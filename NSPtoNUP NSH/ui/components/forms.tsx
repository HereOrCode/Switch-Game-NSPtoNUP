// Shared form parts: 16:9 cover view, localized-name language list and help.

import { Image, Overlay, signal, Text, View, type ViewRef } from "nsh";
import { L } from "../i18n";
import { extension, pathFromUrl } from "../native";
import { Icon, PANEL, white, WHITE } from "./controls";

const IMAGE_TYPES = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "heic"];

/// 16:9 cover; shows a placeholder icon when there is no image. Accepts dropped images when onDropImage is set
export function CoverView(props: {
  src: string | null;
  width: number;
  hint?: string;
  loading?: boolean;
  onDropImage?: (path: string) => void;
}) {
  const dragging = signal(false);
  return (
    <View
      onFileDrop={(e: any) => {
        dragging.set(false);
        const path = e.uris.map(pathFromUrl).find((p: string) => IMAGE_TYPES.includes(extension(p)));
        if (path && props.onDropImage) props.onDropImage(path);
      }}
      onFileDragEnter={() => props.onDropImage && dragging.set(true)}
      onFileDragLeave={() => dragging.set(false)}
      style={{
        width: props.width,
        height: Math.round((props.width * 9) / 16),
        borderRadius: 10,
        overflow: "hidden",
        backgroundColor: white(0.07),
        borderWidth: dragging() ? 2 : 0,
        borderColor: WHITE,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <If
        when={props.src}
        else={
          <View style={{ alignItems: "center", gap: 6 }}>
            <Icon name={props.loading ? "circle-arrow-down" : "image"} size={26} color={white(0.4)} />
            <If when={props.hint}>
              {(hint) => <Text style={{ color: white(0.4), fontSize: 12 }}>{props.loading ? L("cover_status_fetching") : hint()}</Text>}
            </If>
          </View>
        }
      >
        {(src) => <Image src={src()} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
      </If>
    </View>
  );
}

// MARK: - Localized names

/// Languages supported by NUP (matching NACP's 16 language slots); names follow the UI language (language_name_* keys)
export const LANGUAGES: string[] = [
  "zh-Hans", "zh-Hant", "ja", "ko", "en-US", "en-GB", "fr", "fr-CA",
  "de", "it", "es", "es-419", "nl", "pt", "pt-BR", "ru",
];

export const languageName = (tag: string) =>
  LANGUAGES.includes(tag) ? L(`language_name_${tag.toLowerCase().replace("-", "_")}`) : tag;
const languageOrder = (tag: string) => {
  const index = LANGUAGES.indexOf(tag);
  return index < 0 ? LANGUAGES.length : index;
};

export function sortedNames(names: Record<string, string>): [string, string][] {
  return Object.entries(names).sort(([a], [b]) => languageOrder(a) - languageOrder(b));
}

/// Localized-name help: shows an explanation card (with examples) on hover or click
export function LocalizedHelpButton() {
  const hovering = signal(false);
  const pinned = signal(false);
  let anchor: ViewRef | undefined;
  return (
    <View
      ref={anchor}
      role="button"
      accessibilityLabel={L("localized_help_tooltip")}
      onPress={() => pinned.set(!pinned())}
      onMouseEnter={() => hovering.set(true)}
      onMouseLeave={() => hovering.set(false)}
      style={{
        width: 20,
        height: 20,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: white(0.12),
        borderWidth: 1,
        borderColor: white(0.18),
      }}
      hoverStyle={{ backgroundColor: white(0.22) }}
    >
      <Icon name="circle-help" size={13} color={white(0.8)} />
      <If when={hovering() || pinned()}>
        <Overlay
          anchor={anchor}
          placement="bottom"
          align="center"
          offset={8}
          margin={12}
          onPressOutside={() => pinned.set(false)}
          onCancel={() => pinned.set(false)}
          style={{
            width: 300,
            padding: 14,
            gap: 8,
            backgroundColor: PANEL,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: white(0.12),
            boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
          }}
        >
          <Text style={{ color: WHITE, fontSize: 13, fontWeight: "600" }}>{L("section_localized_names")}</Text>
          <Text style={{ color: white(0.7), fontSize: 12 }}>{L("localized_help_message")}</Text>
          <Text style={{ color: white(0.55), fontSize: 11, fontWeight: "600", marginTop: 2 }}>{L("localized_help_example")}</Text>
          <View style={{ gap: 4 }}>
            {[
              [L("localized_help_example_name"), "Splatoon 3"],
              [languageName("zh-Hans"), "斯普拉遁 3"],
              [languageName("ja"), "スプラトゥーン3"],
            ].map(([label, value]) => (
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Text style={{ minWidth: 56, color: white(0.55), fontSize: 12 }}>{label}</Text>
                <Text style={{ color: WHITE, fontSize: 12 }}>{value}</Text>
              </View>
            ))}
          </View>
          <Text style={{ color: white(0.45), fontSize: 11, marginTop: 2 }}>{L("localized_help_tip")}</Text>
        </Overlay>
      </If>
    </View>
  );
}
