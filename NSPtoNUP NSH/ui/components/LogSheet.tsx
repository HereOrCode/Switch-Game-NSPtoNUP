// Conversion log sheet: just the log text; "Download Log… / Copy Log / Done" at the bottom. Same size as the game info sheet.

import { Clipboard, effect, Scroll, signal, Text, untracked, View, type ScrollRef } from "nsh";
import { errorMsg, L, text as msgText } from "../i18n";
import { native } from "../native";
import { showError } from "../state/actions";
import { game } from "../state/library";
import * as queue from "../state/queue";
import { logSheet } from "../state/ui";
import { Button, Sheet, SheetButtons, SheetTitle, sheetSize, SYS } from "./sys";

export function LogSheet() {
  const close = () => logSheet.set(null);
  return (
    <Sheet open={!!logSheet()} onCancel={close} width={sheetSize().width} height={sheetSize().height} label={L("home_log_tooltip")}>
      <Each of={logSheet() ? [logSheet()!] : []}>{(id) => <LogContent id={id()} onClose={close} />}</Each>
    </Sheet>
  );
}

function LogContent(props: { id: string; onClose: () => void }) {
  const id = untracked(() => props.id);
  const name = untracked(() => game(id)?.name ?? "");
  const job = () => queue.latestJob(id);
  const copied = signal(false);
  let scroller: ScrollRef | undefined;

  const text = () => {
    const j = job();
    if (!j) return "";
    j.logVersion();
    return j.log.map((line) => msgText(line)).join("\n");
  };
  const hasLog = () => text().length > 0;

  // Scroll to the bottom when new log lines arrive
  effect(() => {
    text();
    setTimeout(() => scroller?.scrollToEnd({ animated: false }), 30);
  });

  const download = async () => {
    const stamp = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const label = `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())} ${pad(stamp.getHours())}.${pad(stamp.getMinutes())}`;
    // Same content as shown in the sheet (key values hidden)
    await native.saveText(`${L("log_file_name", name || "NSPtoNUP", label)}.txt`, text()).catch((e) => showError(errorMsg(e), L("log_save_failed_title")));
  };

  const copy = () => {
    Clipboard.writeText(text());
    copied.set(true);
    setTimeout(() => copied.set(false), 1500);
  };

  return (
    <View style={{ flex: 1 }}>
      <SheetTitle title={L("log_title", name)} />
      <Scroll
        ref={scroller}
        style={{
          flex: 1,
          marginHorizontal: 20,
          borderWidth: 1,
          borderColor: SYS.border,
          backgroundColor: "#1C1C1E",
        }}
      >
        <View style={{ padding: 10 }}>
          <Text
            style={{
              color: hasLog() ? SYS.text : SYS.secondary,
              fontSize: 12,
              fontFamily: "monospace",
              userSelect: "text",
              lineHeight: 17,
            }}
          >
            {hasLog() ? text() : L("log_empty")}
          </Text>
        </View>
      </Scroll>
      <SheetButtons>
        <Button title={L("log_download")} disabled={!hasLog()} onPress={download} />
        <Button title={copied() ? L("log_copied") : L("log_copy")} disabled={!hasLog()} onPress={copy} />
        <View style={{ flex: 1 }} />
        <Button title={L("action_done")} primary onPress={props.onClose} testID="log-done" />
      </SheetButtons>
    </View>
  );
}
