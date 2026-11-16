// NSPtoNUP landing page: language switching, screenshot gallery, and download links from the latest GitHub release.

const REPO = "HereOrCode/Switch-Game-NSPtoNUP";
const LANGUAGES = ["en", "ja", "zh-Hans"];
const STORAGE_KEY = "nsptonup-language";

const STRINGS = {
  en: {
    title: "NSPtoNUP — Convert Switch NSP files to NUP",
    nav_features: "Features",
    nav_screenshots: "Screenshots",
    nav_download: "Download",
    nav_faq: "FAQ",
    nav_language: "Language",
    hero_eyebrow: "Free & open source · macOS · Windows · Linux",
    hero_title: "Turn your Switch NSP files into NUP",
    hero_subtitle: "Merge a base game, its update and DLC into a single NUP package. Drop in files or whole folders — NSPtoNUP sorts them out for you.",
    hero_download: "Download",
    hero_download_for: "Download for {platform}",
    hero_source: "View on GitHub",
    hero_version: "Version {version} · {date}",
    features_eyebrow: "Features",
    features_title: "Everything a conversion needs",
    f1_title: "Base + Update + DLC",
    f1_body: "Combine a base game with its latest update and all of its DLC into one NUP.",
    f2_title: "Smart folder import",
    f2_body: "Add a whole folder: every NSP is identified and grouped by game automatically.",
    f3_title: "Modern update format",
    f3_body: "Updates in the newer BKTR format are read directly from the NSP — nothing is unpacked first.",
    f4_title: "Game library",
    f4_body: "Covers fetched automatically, editable game info, and a clear view of what's done, failed or converting.",
    f5_title: "Your keys stay yours",
    f5_body: "Key files are never copied or uploaded, and key values never appear in command lines or logs.",
    f6_title: "Native on every desktop",
    f6_body: "macOS, Windows and Linux, on Intel/AMD and ARM, in English, Japanese and Simplified Chinese.",
    shots_eyebrow: "Screenshots",
    shots_title: "Take a look inside",
    shot_home: "Library",
    shot_queue: "Conversion queue",
    shot_editor: "Game info",
    shot_settings: "Settings",
    cap_home: "Your game library, with covers and conversion status at a glance.",
    cap_queue: "Queue several games and follow their progress.",
    cap_editor: "Check and edit game info, cover, updates and DLC before converting.",
    cap_settings: "Choose the language, output folder, notifications and more.",
    steps_eyebrow: "How it works",
    steps_title: "Three steps",
    s1_title: "Set up your keys",
    s1_body: "Choose the prod.keys (and optionally title.keys) dumped from your own console.",
    s2_title: "Add your games",
    s2_body: "Add NSP files or a folder. Base games, updates and DLC are grouped together.",
    s3_title: "Convert",
    s3_body: "NUP files are written to Documents/NSPtoNUP, or any folder you choose.",
    dl_eyebrow: "Download",
    dl_title: "Get NSPtoNUP",
    dl_version: "Latest version {version}, released {date}",
    dl_unavailable: "The first release is on its way. Check back soon, or build from source.",
    dl_all_releases: "All releases",
    dl_build: "Build from source",
    dl_recommended: "Recommended",
    dl_button: "Download",
    dl_soon: "Coming soon",
    os_macos: "macOS",
    os_windows: "Windows",
    os_linux: "Linux",
    arch_apple: "Apple silicon",
    arch_x64: "x64",
    arch_arm64: "ARM64",
    req_macos: "macOS 14 or later",
    req_windows: "Windows 10 1809+ with WebView2",
    req_linux: "GTK 4.14+, glibc 2.39 (Ubuntu 24.04+)",
    faq_eyebrow: "FAQ",
    faq_title: "Questions",
    q1: "What is NUP?",
    a1: "NUP is an unencrypted container format for Nintendo Switch game dumps, created by the nup project. NSPtoNUP reads your NSP files and packs their content into NUP.",
    q2: "Does NSPtoNUP include keys or games?",
    a2: "No. You need your own prod.keys (and optionally title.keys) dumped from your own console, and games you own.",
    q3: "macOS says the app can't be opened",
    a3: "The app is not notarized. The first time, right-click NSPtoNUP.app and choose Open, or allow it in System Settings › Privacy & Security.",
    q4: "What are the system requirements?",
    a4: "macOS 14 or later (Apple silicon); Windows 10 1809 or later with WebView2; Linux with GTK 4.14+ and glibc 2.39 (e.g. Ubuntu 24.04).",
    q5: "Is it free?",
    a5: "Yes. NSPtoNUP is free and open source under the MIT License.",
    footer_disclaimer: "Not affiliated with or endorsed by Nintendo.",
  },
  ja: {
    title: "NSPtoNUP — Switch の NSP ファイルを NUP に変換",
    nav_features: "機能",
    nav_screenshots: "スクリーンショット",
    nav_download: "ダウンロード",
    nav_faq: "よくある質問",
    nav_language: "言語",
    hero_eyebrow: "無料・オープンソース · macOS · Windows · Linux",
    hero_title: "Switch の NSP ファイルを NUP に",
    hero_subtitle: "本体・更新データ・DLC をひとつの NUP パッケージにまとめます。ファイルやフォルダーを追加するだけで、NSPtoNUP が自動で整理します。",
    hero_download: "ダウンロード",
    hero_download_for: "{platform} 版をダウンロード",
    hero_source: "GitHub で見る",
    hero_version: "バージョン {version} · {date}",
    features_eyebrow: "機能",
    features_title: "変換に必要なものをすべて",
    f1_title: "本体 + 更新 + DLC",
    f1_body: "本体に最新の更新データとすべての DLC を合わせて、ひとつの NUP にします。",
    f2_title: "フォルダーをまとめて追加",
    f2_body: "フォルダーを追加すると、中の NSP を識別してゲームごとに自動でグループ化します。",
    f3_title: "新しい更新形式に対応",
    f3_body: "新しい BKTR 形式の更新データも NSP から直接読み込みます。事前の展開は不要です。",
    f4_title: "ゲームライブラリ",
    f4_body: "カバー画像の自動取得、ゲーム情報の編集、完了・失敗・変換中の状態をひと目で確認できます。",
    f5_title: "キーは手元に",
    f5_body: "キーファイルをコピーやアップロードすることはなく、キーの値がコマンドラインやログに出ることもありません。",
    f6_title: "各デスクトップでネイティブ動作",
    f6_body: "macOS・Windows・Linux の Intel/AMD と ARM に対応。英語・日本語・簡体字中国語で使えます。",
    shots_eyebrow: "スクリーンショット",
    shots_title: "アプリの中をのぞいてみる",
    shot_home: "ライブラリ",
    shot_queue: "変換キュー",
    shot_editor: "ゲーム情報",
    shot_settings: "設定",
    cap_home: "カバー画像と変換状態がひと目でわかるゲームライブラリ。",
    cap_queue: "複数のゲームをキューに入れて、進行状況を確認できます。",
    cap_editor: "変換前にゲーム情報・カバー・更新データ・DLC を確認して編集できます。",
    cap_settings: "言語・出力先・通知などを設定できます。",
    steps_eyebrow: "使い方",
    steps_title: "3 ステップ",
    s1_title: "キーを設定",
    s1_body: "自分の本体から吸い出した prod.keys（必要に応じて title.keys）を選びます。",
    s2_title: "ゲームを追加",
    s2_body: "NSP ファイルやフォルダーを追加します。本体・更新データ・DLC はまとめてグループ化されます。",
    s3_title: "変換",
    s3_body: "NUP ファイルは「書類/NSPtoNUP」または任意のフォルダーに保存されます。",
    dl_eyebrow: "ダウンロード",
    dl_title: "NSPtoNUP を入手",
    dl_version: "最新バージョン {version}（{date} 公開）",
    dl_unavailable: "最初のリリースを準備中です。しばらくお待ちいただくか、ソースからビルドしてください。",
    dl_all_releases: "すべてのリリース",
    dl_build: "ソースからビルド",
    dl_recommended: "おすすめ",
    dl_button: "ダウンロード",
    dl_soon: "近日公開",
    os_macos: "macOS",
    os_windows: "Windows",
    os_linux: "Linux",
    arch_apple: "Apple シリコン",
    arch_x64: "x64",
    arch_arm64: "ARM64",
    req_macos: "macOS 14 以降",
    req_windows: "Windows 10 1809 以降、WebView2",
    req_linux: "GTK 4.14 以降、glibc 2.39（Ubuntu 24.04 以降）",
    faq_eyebrow: "よくある質問",
    faq_title: "質問",
    q1: "NUP とは？",
    a1: "NUP は Nintendo Switch のゲームダンプ向けの暗号化されていないコンテナ形式で、nup プロジェクトが作成しました。NSPtoNUP は NSP ファイルを読み込み、その内容を NUP にまとめます。",
    q2: "キーやゲームは含まれていますか？",
    a2: "いいえ。自分の本体から吸い出した prod.keys（必要に応じて title.keys）と、自分が所有するゲームが必要です。",
    q3: "macOS で「開けません」と表示される",
    a3: "このアプリは公証されていません。初回は NSPtoNUP.app を右クリックして「開く」を選ぶか、「システム設定 › プライバシーとセキュリティ」で許可してください。",
    q4: "動作環境は？",
    a4: "macOS 14 以降（Apple シリコン）、Windows 10 1809 以降（WebView2 が必要）、Linux は GTK 4.14 以降と glibc 2.39（Ubuntu 24.04 など）。",
    q5: "無料ですか？",
    a5: "はい。NSPtoNUP は MIT ライセンスの無料オープンソースソフトウェアです。",
    footer_disclaimer: "任天堂とは関係がなく、任天堂の承認を受けたものではありません。",
  },
  "zh-Hans": {
    title: "NSPtoNUP — 把 Switch NSP 文件转换为 NUP",
    nav_features: "功能",
    nav_screenshots: "截图",
    nav_download: "下载",
    nav_faq: "常见问题",
    nav_language: "语言",
    hero_eyebrow: "免费开源 · macOS · Windows · Linux",
    hero_title: "把 Switch NSP 文件转换为 NUP",
    hero_subtitle: "将本体、更新和 DLC 合并成一个 NUP 包。直接添加文件或整个文件夹，NSPtoNUP 会自动帮你整理。",
    hero_download: "下载",
    hero_download_for: "下载 {platform} 版",
    hero_source: "在 GitHub 查看",
    hero_version: "版本 {version} · {date}",
    features_eyebrow: "功能",
    features_title: "转换所需，一应俱全",
    f1_title: "本体 + 更新 + DLC",
    f1_body: "把本体、最新更新和全部 DLC 合并成一个 NUP。",
    f2_title: "智能导入文件夹",
    f2_body: "添加整个文件夹，自动识别其中的 NSP 并按游戏分组。",
    f3_title: "支持新版更新格式",
    f3_body: "新版 BKTR 格式的更新直接从 NSP 读取，无需先解包。",
    f4_title: "游戏库",
    f4_body: "自动获取封面，可编辑游戏信息，已完成、失败、转换中一目了然。",
    f5_title: "密钥只在你手里",
    f5_body: "密钥文件不会被复制或上传，密钥内容也不会出现在命令行或日志中。",
    f6_title: "各平台原生运行",
    f6_body: "支持 macOS、Windows、Linux 的 Intel/AMD 与 ARM，界面提供英文、日文和简体中文。",
    shots_eyebrow: "截图",
    shots_title: "看看里面",
    shot_home: "游戏库",
    shot_queue: "转换队列",
    shot_editor: "游戏信息",
    shot_settings: "设置",
    cap_home: "游戏库：封面和转换状态一目了然。",
    cap_queue: "多个游戏排队转换，随时查看进度。",
    cap_editor: "转换前检查并编辑游戏信息、封面、更新和 DLC。",
    cap_settings: "设置语言、输出目录、通知等。",
    steps_eyebrow: "使用方法",
    steps_title: "三个步骤",
    s1_title: "设置密钥",
    s1_body: "选择从你自己的主机导出的 prod.keys（可选 title.keys）。",
    s2_title: "添加游戏",
    s2_body: "添加 NSP 文件或文件夹，本体、更新和 DLC 会自动归到一起。",
    s3_title: "开始转换",
    s3_body: "NUP 文件默认保存到「文稿/NSPtoNUP」，也可以选择任意文件夹。",
    dl_eyebrow: "下载",
    dl_title: "获取 NSPtoNUP",
    dl_version: "最新版本 {version}，发布于 {date}",
    dl_unavailable: "首个版本即将发布。请稍后再来，或从源码构建。",
    dl_all_releases: "全部版本",
    dl_build: "从源码构建",
    dl_recommended: "推荐",
    dl_button: "下载",
    dl_soon: "即将推出",
    os_macos: "macOS",
    os_windows: "Windows",
    os_linux: "Linux",
    arch_apple: "Apple 芯片",
    arch_x64: "x64",
    arch_arm64: "ARM64",
    req_macos: "macOS 14 或更高版本",
    req_windows: "Windows 10 1809 或更高版本，需要 WebView2",
    req_linux: "GTK 4.14+、glibc 2.39（Ubuntu 24.04 或更高版本）",
    faq_eyebrow: "常见问题",
    faq_title: "问与答",
    q1: "NUP 是什么？",
    a1: "NUP 是 nup 项目定义的一种未加密的 Nintendo Switch 游戏转储容器格式。NSPtoNUP 读取你的 NSP 文件，并把其中的内容打包成 NUP。",
    q2: "NSPtoNUP 附带密钥或游戏吗？",
    a2: "不附带。你需要自备从自己主机导出的 prod.keys（可选 title.keys），以及你拥有的游戏。",
    q3: "macOS 提示无法打开 App",
    a3: "这个 App 没有经过公证。第一次打开时，请右键点击 NSPtoNUP.app 并选择「打开」，或者在「系统设置 › 隐私与安全性」中允许。",
    q4: "系统要求是什么？",
    a4: "macOS 14 或更高版本（Apple 芯片）；Windows 10 1809 或更高版本，需要 WebView2；Linux 需要 GTK 4.14+ 和 glibc 2.39（例如 Ubuntu 24.04）。",
    q5: "免费吗？",
    a5: "免费。NSPtoNUP 基于 MIT 许可证开源。",
    footer_disclaimer: "本项目与任天堂无关，也未获得任天堂认可。",
  },
};

// Release packages, in display order
const PACKAGES = [
  { id: "macos-arm64", os: "macos", arch: "arch_apple", file: "NSPtoNUP-macos-arm64.zip", req: "req_macos" },
  { id: "windows-x64", os: "windows", arch: "arch_x64", file: "NSPtoNUP-windows-x64.zip", req: "req_windows" },
  { id: "windows-arm64", os: "windows", arch: "arch_arm64", file: "NSPtoNUP-windows-arm64.zip", req: "req_windows" },
  { id: "linux-x64", os: "linux", arch: "arch_x64", file: "NSPtoNUP-linux-x64.tar.gz", req: "req_linux" },
  { id: "linux-arm64", os: "linux", arch: "arch_arm64", file: "NSPtoNUP-linux-arm64.tar.gz", req: "req_linux" },
];

const OS_ICONS = {
  macos: '<path d="M16.4 12.6c0-2.5 2-3.7 2.1-3.8-1.2-1.7-3-1.9-3.6-2-1.5-.2-3 .9-3.8.9-.8 0-2-.9-3.3-.9-1.7 0-3.3 1-4.1 2.5-1.8 3.1-.5 7.6 1.3 10.1.8 1.2 1.8 2.6 3.1 2.5 1.3 0 1.7-.8 3.2-.8s1.9.8 3.3.8c1.3 0 2.2-1.2 3-2.5.9-1.4 1.3-2.7 1.3-2.8-.1 0-2.5-1-2.5-4ZM14 5.2c.7-.8 1.1-1.9 1-3.1-1 .1-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4Z"/>',
  windows: '<path d="M3 5.5 10.4 4.5v7H3v-6Zm0 13 7.4 1v-7H3v6Zm8.3 1.1L21 21V12.5h-9.7v7.1Zm0-15.2v7.1H21V3l-9.7 1.4Z"/>',
  linux: '<path d="M12 2c-2 0-3.3 1.7-3.3 4.2 0 1.2.3 2.1-.4 3.3-.9 1.5-2.6 3.2-2.6 6 0 .8.2 1.5.5 2.1-.8.4-1.7.9-1.7 1.6 0 1 1.7 1.2 3 1.6 1.1.3 1.9 1.2 3 1.2.8 0 1.3-.4 1.5-.7h0c.2.3.7.7 1.5.7 1.1 0 1.9-.9 3-1.2 1.3-.4 3-.6 3-1.6 0-.7-.9-1.2-1.7-1.6.3-.6.5-1.3.5-2.1 0-2.8-1.7-4.5-2.6-6-.7-1.2-.4-2.1-.4-3.3C15.3 3.7 14 2 12 2Zm-1.4 4c.4 0 .7.5.7 1.1 0 .6-.3 1.1-.7 1.1s-.7-.5-.7-1.1c0-.6.3-1.1.7-1.1Zm2.8 0c.4 0 .7.5.7 1.1 0 .6-.3 1.1-.7 1.1s-.7-.5-.7-1.1c0-.6.3-1.1.7-1.1ZM12 9.3c.9 0 2 .6 2 1 0 .5-1.1 1.1-2 1.1s-2-.6-2-1.1c0-.4 1.1-1 2-1Z"/>',
};

const SHOTS = ["queue", "editor", "settings", "home"];

let language = "en";
let release = null; // { version, date, assets: Map<file, url> } or null when there is no release yet
let detected = null; // package id for this visitor, or null

// MARK: - Language

/// Picks a language the way the app does: the first preferred language decides; anything else is English
function resolveLanguage(preferred) {
  const tag = (preferred[0] || "en").toLowerCase();
  if (tag.startsWith("ja")) return "ja";
  if (tag === "zh" || tag.startsWith("zh-hans") || tag === "zh-cn" || tag === "zh-sg") return "zh-Hans";
  return "en";
}

function storedLanguage() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return LANGUAGES.includes(value) ? value : null;
  } catch {
    return null;
  }
}

function t(key, params = {}) {
  const text = STRINGS[language][key] ?? STRINGS.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name) => params[name] ?? "");
}

function formatDate(iso) {
  return new Intl.DateTimeFormat(language, { year: "numeric", month: "long", day: "numeric" }).format(new Date(iso));
}

function setLanguage(value, remember) {
  language = value;
  if (remember) {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {}
  }
  document.documentElement.lang = value;
  document.title = t("title");
  document.getElementById("lang").value = value;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  renderShotCaption();
  renderDownloads();
}

// MARK: - Screenshots

let currentShot = SHOTS[0];

function showShot(name) {
  currentShot = name;
  const image = document.getElementById("shot-image");
  image.style.opacity = "0";
  const next = new Image();
  next.src = `assets/screenshots/${name}.jpg`;
  next.onload = () => {
    image.src = next.src;
    image.style.opacity = "1";
  };
  document.querySelectorAll(".shot-tab").forEach((tab) => {
    tab.setAttribute("aria-selected", String(tab.dataset.shot === name));
  });
  renderShotCaption();
}

function renderShotCaption() {
  document.getElementById("shot-caption").textContent = t(`cap_${currentShot}`);
  document.getElementById("shot-image").alt = t(`cap_${currentShot}`);
}

// MARK: - Platform

async function detectPlatform() {
  const ua = navigator.userAgent;
  const platform = navigator.userAgentData?.platform || navigator.platform || "";
  let os = null;
  if (/Mac/i.test(platform) || /Macintosh/.test(ua)) os = "macos";
  else if (/Win/i.test(platform) || /Windows/.test(ua)) os = "windows";
  else if (/Linux/i.test(platform) && !/Android/i.test(ua)) os = "linux";
  if (!os) return null;
  if (os === "macos") return "macos-arm64";

  let arm = /aarch64|arm64/i.test(ua);
  try {
    const values = await navigator.userAgentData?.getHighEntropyValues(["architecture"]);
    if (values?.architecture) arm = values.architecture === "arm";
  } catch {}
  return `${os}-${arm ? "arm64" : "x64"}`;
}

function platformName(pkg) {
  return `${t(`os_${pkg.os}`)} (${t(pkg.arch)})`;
}

// MARK: - Downloads

async function loadRelease() {
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return {
      version: data.tag_name,
      date: data.published_at,
      assets: new Map(data.assets.map((asset) => [asset.name, asset.browser_download_url])),
    };
  } catch {
    return null;
  }
}

function renderDownloads() {
  const list = document.getElementById("dl-list");
  list.innerHTML = "";
  for (const pkg of PACKAGES) {
    const url = release?.assets.get(pkg.file);
    const recommended = pkg.id === detected;
    const row = document.createElement("div");
    row.className = `flex flex-col gap-4 rounded-2xl border p-5 sm:flex-row sm:items-center ${
      recommended ? "border-accent/60 bg-accent/10" : "border-line bg-panel/80"
    }`;
    row.innerHTML = `
      <svg viewBox="0 0 24 24" class="size-8 shrink-0 text-white/80" fill="currentColor">${OS_ICONS[pkg.os]}</svg>
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-semibold"></span>
          ${recommended ? '<span class="rounded-full bg-accent/20 px-2 py-0.5 text-xs font-medium text-accent"></span>' : ""}
        </div>
        <p class="mt-1 text-sm text-mute"></p>
      </div>`;
    row.querySelector(".font-semibold").textContent = platformName(pkg);
    if (recommended) row.querySelector(".text-accent").textContent = t("dl_recommended");
    row.querySelector("p").textContent = `${pkg.file} · ${t(pkg.req)}`;

    const button = document.createElement(url ? "a" : "span");
    button.className = url
      ? "btn-primary px-5 py-2 text-sm"
      : "inline-flex items-center justify-center rounded-full border border-white/10 px-5 py-2 text-sm text-mute";
    button.textContent = url ? t("dl_button") : t("dl_soon");
    if (url) button.href = url;
    row.append(button);
    list.append(row);
  }

  document.getElementById("dl-unavailable").classList.toggle("hidden", Boolean(release));
  document.getElementById("dl-version").textContent = release
    ? t("dl_version", { version: release.version, date: formatDate(release.date) })
    : "";
  document.getElementById("hero-version").textContent = release
    ? t("hero_version", { version: release.version, date: formatDate(release.date) })
    : "";

  const hero = document.getElementById("hero-download");
  const heroLabel = document.getElementById("hero-download-label");
  const pkg = PACKAGES.find((p) => p.id === detected);
  const url = pkg && release?.assets.get(pkg.file);
  hero.href = url || "#download";
  heroLabel.textContent = pkg ? t("hero_download_for", { platform: platformName(pkg) }) : t("hero_download");
}

// MARK: - Navigation

function updateNav() {
  const nav = document.getElementById("nav");
  const scrolled = window.scrollY > 24;
  nav.classList.toggle("bg-ink/80", scrolled);
  nav.classList.toggle("backdrop-blur-md", scrolled);
  nav.classList.toggle("border-b", scrolled);
  nav.classList.toggle("border-line", scrolled);
}

// MARK: - Start

document.getElementById("lang").addEventListener("change", (event) => setLanguage(event.target.value, true));
document.querySelectorAll(".shot-tab").forEach((tab) => {
  tab.setAttribute("role", "tab");
  tab.addEventListener("click", () => showShot(tab.dataset.shot));
});
window.addEventListener("scroll", updateNav, { passive: true });
updateNav();

setLanguage(storedLanguage() ?? resolveLanguage(navigator.languages?.length ? navigator.languages : [navigator.language]), false);
showShot(SHOTS[0]);

Promise.all([detectPlatform(), loadRelease()]).then(([platform, latest]) => {
  detected = platform;
  release = latest;
  renderDownloads();
});
