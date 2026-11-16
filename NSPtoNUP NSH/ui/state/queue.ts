// Conversion queue (one task at a time) + game library operations such as importing NSPs and managing covers.

import { batch, signal } from "nsh";
import { concat, errorMsg, L, Lc, msg, type Msg } from "../i18n";
import { extension, fileName, native, type ConvertOutput, type NspContent, type PipelineEvent } from "../native";
import {
  addGame,
  containsNsp,
  contents,
  coverPath,
  coverUrl,
  game,
  games,
  lastErrorFields,
  metadataErrorFields,
  newImageName,
  nspExists,
  removeGame,
  sortContents,
  updateGame,
  updateOf,
  uuid,
  warningFields,
  type AttachedContent,
  type CoverSource,
  type Game,
  type Skip,
} from "./library";
import { autoCover, cleanupWorkDir, keysProblem, outputDirectory, validKeysPath, validTitleKeysPath } from "./settings";
import { simulatedDuration, STEPS } from "./steps";

export type StepState = { kind: "pending" } | { kind: "running" } | { kind: "done"; detail: Msg | string } | { kind: "failed" };
/// Log line: tool output is verbatim text; lines the app writes itself are Msg (translated with the UI language)
export type LogLine = string | Msg;
export type JobState = "waiting" | "running" | "finished" | "failed" | "cancelled";

/// Clock ticking every 0.25 s: keeps simulated progress and remaining time updating during conversion
export const now = signal(Date.now());
let ticker: ReturnType<typeof setInterval> | undefined;

export class Job {
  readonly id = uuid();
  readonly state = signal<JobState>("waiting");
  readonly error = signal<Msg | null>(null);
  readonly steps = signal<StepState[]>(STEPS.map(() => ({ kind: "pending" })));
  readonly currentStep = signal<number | null>(null);
  /// Progress within the current step; null means indeterminate
  readonly stepProgress = signal<number | null>(null);
  /// Log: appended frequently; logVersion notifies the UI
  readonly log: LogLine[] = [];
  /// Cleared from "Recently Finished" in the queue panel (the log can still be viewed)
  readonly clearedFromRecent = signal(false);
  readonly logVersion = signal(0);
  startedAt: number | null = null;
  /// When the current step started (for simulated progress)
  stepStartedAt: number | null = null;
  /// NSP size, used to estimate simulated progress of large steps
  fileSize = 0;
  /// Progress and time of the last noticeable advance (at least 0.5%): creeps forward when there's no noticeable advance for a long time (e.g. verification after packing)
  private stepProgressMark = 0;
  private stepProgressChangedAt = Date.now();
  /// Highest progress shown so far: progress never decreases
  private peak = 0;

  constructor(readonly gameId: string) {}

  /// Overall progress 0...1: sum of finished steps' weights + current step's weight × in-step progress.
  /// Without real in-step progress, simulated progress is used: it approaches 90% over time without overshooting, and fills up when the step finishes
  overallProgress(): number {
    const t = now();
    let value = 0;
    this.steps().forEach((state, step) => {
      if (state.kind === "done") value += STEPS[step].weight;
      else if (state.kind === "running") {
        const measured = this.stepProgress();
        value += STEPS[step].weight * (measured != null ? this.creeping(measured, t) : this.simulated(step, t));
      }
    });
    if (this.state() === "finished") value = 1;
    this.peak = Math.max(this.peak, Math.min(value, 1));
    return this.peak;
  }

  /// When real progress hasn't changed for over 1 s, creep toward 99% (covering 60% of the remainder in about 8 s)
  private creeping(measured: number, t: number): number {
    const stalled = (t - this.stepProgressChangedAt) / 1000 - 1;
    if (stalled <= 0) return measured;
    return measured + (0.99 - measured) * (1 - Math.exp(-stalled / 8));
  }

  private simulated(step: number, t: number): number {
    if (this.stepStartedAt == null) return 0;
    const elapsed = (t - this.stepStartedAt) / 1000;
    return 0.9 * (1 - Math.exp(-elapsed / simulatedDuration(step, this.fileSize)));
  }

  setStep(step: number, state: StepState) {
    this.steps.update((list) => list.map((s, i) => (i === step ? state : s)));
  }

  append(line: LogLine) {
    this.log.push(line);
    if (this.log.length > 3000) this.log.splice(0, this.log.length - 3000);
    scheduleLogFlush(this);
  }

  handle(event: PipelineEvent) {
    // After finishing, only accept step completion and logs
    if (this.state() !== "running" && event.type !== "stepFinished" && event.type !== "log" && event.type !== "logMsg") return;
    switch (event.type) {
      case "stepStarted":
        batch(() => {
          this.currentStep.set(event.step);
          this.setStep(event.step, { kind: "running" });
          this.stepProgress.set(null);
        });
        this.stepStartedAt = Date.now();
        this.stepProgressMark = 0;
        this.stepProgressChangedAt = Date.now();
        break;
      case "stepFinished":
        batch(() => {
          this.setStep(event.step, { kind: "done", detail: event.detail });
          this.stepProgress.set(null);
        });
        break;
      case "progress":
        // Only accept real progress, never decreasing; ignore "indeterminate" events (cleared at step start; the UI shows simulated progress)
        if (event.value != null) {
          this.stepProgress.set(Math.max(this.stepProgress() ?? 0, event.value));
          // Only a noticeable advance resets the stall timer; tiny increases count as stalled so the progress bar keeps creeping
          if (event.value - this.stepProgressMark >= 0.005) {
            this.stepProgressMark = event.value;
            this.stepProgressChangedAt = Date.now();
          }
        }
        break;
      case "log":
        this.append(event.line);
        break;
      case "logMsg":
        this.append(event.msg);
        break;
    }
  }
}

/// The log refreshes the UI at most every 0.1 s: tools can output thousands of lines per second
const pendingLogs = new Set<Job>();
let logTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleLogFlush(job: Job) {
  pendingLogs.add(job);
  logTimer ??= setTimeout(() => {
    logTimer = undefined;
    batch(() => pendingLogs.forEach((j) => j.logVersion.update((n) => n + 1)));
    pendingLogs.clear();
  }, 100);
}

/// A batch of consecutive conversions: from enqueuing while the queue is idle until it is idle again
export interface ConversionBatch {
  total: number;
  finished: number;
  succeeded: number;
  failed: number;
  bytesTotal: number;
  bytesFinished: number;
  outputBytes: number;
  startedAt: number;
}

export const jobs = signal<Job[]>([]);
/// Each game's most recently finished task (used by the log page)
export const history = signal<Record<string, Job>>({});
/// Current batch; after the queue goes idle, the last batch's results are kept until the next batch starts
export const currentBatch = signal<ConversionBatch | null>(null);
/// Notified when a task finishes (system notification, Dock)
export const finishedJob = signal<Job | null>(null, { equals: false });

export const currentJob = () => jobs().find((j) => j.state() === "running");
export const waitingJobs = () => jobs().filter((j) => j.state() === "waiting");
export const jobFor = (gameId: string) => jobs().find((j) => j.gameId === gameId);
export const isBusy = (gameId: string) => !!jobFor(gameId);
export const isRunning = () => jobs().length > 0;
/// Running or just-finished tasks, for viewing logs
export const latestJob = (gameId: string) => jobFor(gameId) ?? history()[gameId];

/// Tasks in the queue panel's "Recently Finished": finished, not cleared, most recently started first
export const recentJobs = () =>
  Object.values(history())
    .filter((j) => !isBusy(j.gameId) && !j.clearedFromRecent())
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));

/// Clears "Recently Finished": only hides them from the queue panel, without deleting logs or changing game state
export function clearRecent() {
  batch(() => Object.values(history()).forEach((j) => j.clearedFromRecent.set(true)));
}

/// Games eligible for "Convert All": info read, not converted or failed, not in the queue
export const pendingGames = () => games().filter((g) => g.metadataLoaded && g.status !== "converted" && !isBusy(g.id));

/// Overall batch progress 0...1
export function batchProgress(): number {
  const b = currentBatch();
  if (!b || b.bytesTotal <= 0) return 0;
  let done = b.bytesFinished;
  const job = currentJob();
  const g = job && game(job.gameId);
  if (job && g) done += g.fileSize * job.overallProgress();
  return Math.min(done / b.bytesTotal, 1);
}

/// Estimated remaining seconds; not estimated right after starting
export function remainingSeconds(startedAt: number | null, progress: number): number | null {
  if (startedAt == null) return null;
  const elapsed = (now() - startedAt) / 1000;
  if (elapsed <= 8 || progress <= 0.02) return null;
  return (elapsed * (1 - progress)) / progress;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return L("duration_under_minute");
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return Lc("duration_minutes", minutes);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? L("duration_hours_minutes", hours, rest) : Lc("duration_hours", hours);
}

// MARK: - Queue

function changed() {
  const running = isRunning();
  if (running && !ticker) ticker = setInterval(() => now.set(Date.now()), 250);
  if (!running && ticker) {
    clearInterval(ticker);
    ticker = undefined;
  }
}

export function enqueue(ids: string[]) {
  const accepted = ids.filter((id) => !isBusy(id) && game(id));
  if (!accepted.length) return;
  batch(() => {
    let b = isRunning() ? { ...currentBatch()! } : newBatch();
    const added = accepted.map((id) => {
      b.total += 1;
      b.bytesTotal += game(id)?.fileSize ?? 0;
      return new Job(id);
    });
    currentBatch.set(b);
    jobs.set([...jobs(), ...added]);
  });
  changed();
  startNextIfIdle();
}

function newBatch(): ConversionBatch {
  return { total: 0, finished: 0, succeeded: 0, failed: 0, bytesTotal: 0, bytesFinished: 0, outputBytes: 0, startedAt: Date.now() };
}

export const enqueueAll = () => enqueue(pendingGames().map((g) => g.id));

/// Stop: removes all queued tasks and cancels the running one
export function stopAll() {
  const waiting = waitingJobs();
  batch(() => {
    jobs.set(jobs().filter((j) => j.state() !== "waiting"));
    updateBatch((b) => {
      b.total -= waiting.length;
      for (const job of waiting) b.bytesTotal -= game(job.gameId)?.fileSize ?? 0;
    });
  });
  const current = currentJob();
  if (current) native.cancel(current.id);
  changed();
}

export function cancel(gameId: string) {
  const job = jobFor(gameId);
  if (!job) return;
  if (job.state() === "running") {
    native.cancel(job.id);
    return;
  }
  batch(() => {
    jobs.set(jobs().filter((j) => j !== job));
    updateBatch((b) => {
      b.total -= 1;
      b.bytesTotal -= game(gameId)?.fileSize ?? 0;
    });
  });
  changed();
}

function updateBatch(change: (b: ConversionBatch) => void) {
  const b = currentBatch();
  if (!b) return;
  const copy = { ...b };
  change(copy);
  currentBatch.set(copy);
}

function startNextIfIdle() {
  if (currentJob()) return;
  const job = waitingJobs()[0];
  const g = job && game(job.gameId);
  if (!job || !g) return;
  const keys = validKeysPath();
  if (!keys) {
    // When configured but unusable, explain the specific reason
    const reason = keysProblem();
    return fail(job, reason ? msg("error_keys_unusable", reason) : msg("error_keys_not_configured"));
  }
  if (!nspExists(g)) return fail(job, msg("error_nsp_missing", g.nspPath));

  job.startedAt = Date.now();
  job.fileSize = g.fileSize;
  job.state.set("running");
  changed();

  const coverDestination = coverPath(newImageName(g.id, "cover"));
  native
    .convert(
      job.id,
      {
        nsp: g.nspPath,
        extras: contents(g).map((c) => ({ kind: c.kind, nsp: c.nspPath, version: c.version })),
        keys,
        titleKeys: validTitleKeysPath(),
        outputDirectory: outputDirectory(),
        previousOutput: g.nupPath ?? null,
        name: g.name,
        publisher: g.publisher ?? null,
        displayVersion: g.displayVersion ?? null,
        localizedNames: g.localizedNames,
        cover: coverUrl(g),
        autoCover: autoCover() && !g.coverLookupFailed,
        coverDestination,
        cleanup: cleanupWorkDir(),
      },
      (event) => job.handle(event),
    )
    .then((result) => {
      if (result.ok) complete(job, result.output);
      else if (result.cancelled) finish(job, "cancelled");
      else fail(job, result.error);
    })
    .catch((error) => fail(job, errorMsg(error)));
}

function complete(job: Job, output: ConvertOutput) {
  updateGame(job.gameId, (g) => ({
    status: "converted",
    // Record the update and DLC included in this conversion: prompt to convert again if they change later
    convertedContentPaths: contents(g).length ? contents(g).map((c) => c.nspPath) : null,
    nupPath: output.nup,
    nupSize: output.nupSize,
    convertedAt: new Date().toISOString(),
    ...lastErrorFields(null),
    ...warningFields(output.warnings),
    titleId: g.titleId ?? output.titleId,
    name: output.name,
    publisher: output.publisher,
    displayVersion: output.displayVersion,
    localizedNames: output.localizedNames,
    ...(output.coverDownloaded
      ? { coverFile: fileName(output.cover!), coverSource: "downloaded" as CoverSource }
      : output.cover == null
        ? { coverLookupFailed: true }
        : {}),
  }));
  const step = job.currentStep();
  if (step != null && job.steps()[step].kind === "running") job.setStep(step, { kind: "done", detail: fileName(output.nup) });
  job.stepProgress.set(null);
  job.append(msg("log_generated", output.nup));
  output.warnings.forEach((w) => job.append(concat("⚠ ", w)));
  finish(job, "finished");
}

function fail(job: Job, reason: Msg) {
  const step = job.currentStep();
  if (step != null) job.setStep(step, { kind: "failed" });
  job.append(concat("✘ ", reason));
  job.error.set(reason);
  updateGame(job.gameId, () => ({ status: "failed", ...lastErrorFields(reason) }));
  finish(job, "failed");
}

function finish(job: Job, state: JobState) {
  if (state === "cancelled") {
    const step = job.currentStep();
    if (step != null) job.setStep(step, { kind: "failed" });
    job.append(msg("log_cancelled"));
  }
  batch(() => {
    job.state.set(state);
    jobs.set(jobs().filter((j) => j !== job));
    history.set({ ...history(), [job.gameId]: job });
    const g = game(job.gameId);
    updateBatch((b) => {
      b.finished += 1;
      b.bytesFinished += g?.fileSize ?? 0;
      if (state === "finished") {
        b.succeeded += 1;
        b.outputBytes += g?.nupSize ?? 0;
      } else if (state === "failed") b.failed += 1;
    });
    finishedJob.set(job);
  });
  changed();
  startNextIfIdle();
}

// MARK: - Import

/// Checks NSPs to add: returns the files that can be added and the reasons for skipped ones
export function checkNsps(paths: string[]): { accepted: string[]; skipped: Skip[] } {
  const accepted: string[] = [];
  const skipped: Skip[] = [];
  for (const path of paths) {
    if (extension(path) !== "nsp") skipped.push([path, msg("skip_not_nsp")]);
    else if (containsNsp(path) || accepted.includes(path)) skipped.push([path, msg("skip_already_in_library")]);
    else accepted.push(path);
  }
  return { accepted, skipped };
}

/// Info being edited in the "Add Game" sheet; written to the game library by addFromDraft on confirmation
export interface GameDraft {
  name: string;
  titleId: string | null;
  publisher: string | null;
  displayVersion: string | null;
  localizedNames: Record<string, string>;
  /// Whether info has been read from the NSP (false when prod.keys isn't configured)
  metadataLoaded: boolean;
  /// 1:1 icon in the temp directory
  icon: string | null;
  /// 16:9 cover in the temp directory
  cover: string | null;
  coverSource: CoverSource;
}

/// Adds to the game library after the user confirms in the "Add Game" sheet
export function addFromDraft(nsp: string, draft: GameDraft): string {
  const id = uuid();
  const value: Game = {
    id,
    nspPath: nsp,
    fileSize: native.fileInfo(nsp).size,
    addedAt: new Date().toISOString(),
    titleId: draft.titleId,
    name: draft.name,
    publisher: draft.publisher,
    displayVersion: draft.displayVersion,
    localizedNames: draft.localizedNames,
    metadataLoaded: draft.metadataLoaded,
    coverLookupFailed: false,
    status: "notConverted",
    warnings: [],
  };
  if (draft.icon) {
    const name = newImageName(id, "icon");
    try {
      native.moveFile(draft.icon, coverPath(name));
      value.iconFile = name;
    } catch {}
  }
  if (draft.cover) {
    const name = newImageName(id, "cover");
    try {
      native.moveFile(draft.cover, coverPath(name));
      value.coverFile = name;
      value.coverSource = draft.coverSource;
    } catch {}
  } else if (draft.metadataLoaded) {
    // Automatic fetch failed or was removed: don't retry automatically, to avoid overriding the user's choice
    value.coverLookupFailed = true;
  }
  addGame(value);
  // Games added without prod.keys get their info read once keys are configured
  if (!draft.metadataLoaded) loadMetadata(id);
  return id;
}

// MARK: - Updates and DLC

export function toAttached(content: NspContent, displayVersion: string | null = null): AttachedContent {
  return {
    kind: content.kind === "update" ? "update" : "dlc",
    nspPath: content.path,
    titleId: content.titleId,
    version: content.version,
    displayVersion,
    fileSize: content.size,
  };
}

/// Attaches an update or DLC to a game: only one update is kept (replacing the old one), and the same DLC is replaced by the new file.
/// Then reads the update's display version (e.g. 1.0.137848); when adoptVersion is true it also becomes the game's version
export function attach(items: NspContent[], gameId: string, versions: Record<string, string> = {}, adoptVersion = true) {
  const extras = items.filter((i) => i.kind !== "base");
  if (!extras.length) return;
  updateGame(gameId, (g) => {
    let list = contents(g);
    for (const item of extras) {
      const content = toAttached(item, versions[item.path] ?? null);
      list = list.filter((c) => !(c.kind === content.kind && (content.kind === "update" || c.titleId === content.titleId)));
      list.push(content);
    }
    return { attached: sortContents(list) };
  });
  const update = extras.find((e) => e.kind === "update");
  const keys = validKeysPath();
  if (!update || !keys || versions[update.path]) return;
  native
    .probe(update.path, keys, validTitleKeysPath(), null, true)
    .then((info) => {
      if (!info.displayVersion) return;
      updateGame(gameId, (g) => ({
        attached: contents(g).map((c) => (c.nspPath === update.path ? { ...c, displayVersion: info.displayVersion } : c)),
        ...(adoptVersion ? { displayVersion: info.displayVersion } : {}),
      }));
    })
    .catch(() => {});
}

/// Removes an attached update or DLC (without deleting the file)
export function detach(paths: Set<string>, gameId: string) {
  updateGame(gameId, (g) => {
    const list = contents(g).filter((c) => !paths.has(c.nspPath));
    return { attached: list.length ? list : null };
  });
}

/// Games whose info is being read
export const reading = signal<Set<string>>(new Set());

/// Reads nacp info (requires prod.keys), then tries to download the cover automatically
export async function loadMetadata(gameId: string) {
  const g = game(gameId);
  const keys = validKeysPath();
  if (!g || !keys || reading().has(gameId)) return;
  reading.set(new Set([...reading(), gameId]));
  const iconName = newImageName(gameId, "icon");
  try {
    const result = await native.probe(g.nspPath, keys, validTitleKeysPath(), coverPath(iconName));
    const old = game(gameId)?.iconFile;
    if (result.icon && old) native.removeFile(coverPath(old));
    updateGame(gameId, (current) => ({
      metadataLoaded: true,
      ...metadataErrorFields(null),
      titleId: result.titleId,
      name: result.name ?? current.name,
      publisher: result.publisher,
      // When there's an update, its version takes precedence
      displayVersion: (updateOf(current)?.displayVersion ?? null) || result.displayVersion,
      localizedNames: result.localizedNames,
      ...(result.icon ? { iconFile: iconName } : {}),
    }));
    downloadCoverIfNeeded(gameId);
  } catch (error: any) {
    updateGame(gameId, () => metadataErrorFields(errorMsg(error)));
  } finally {
    const next = new Set(reading());
    next.delete(gameId);
    reading.set(next);
  }
}

/// Reads info for all games not yet read successfully (e.g. right after prod.keys is configured)
export function loadMissingMetadata() {
  games()
    .filter((g) => !g.metadataLoaded)
    .forEach((g) => loadMetadata(g.id));
}

// MARK: - Covers

export const downloadingCovers = signal<Set<string>>(new Set());

export function downloadCoverIfNeeded(gameId: string) {
  const g = game(gameId);
  if (!autoCover() || !g || g.coverFile || g.coverLookupFailed) return;
  downloadCover(gameId);
}

/// Downloads the cover; returns the reason on failure
export async function downloadCover(gameId: string): Promise<Msg | null> {
  const g = game(gameId);
  if (!g?.titleId) return msg("error_no_title_id_configure_keys");
  if (downloadingCovers().has(gameId)) return null;
  downloadingCovers.set(new Set([...downloadingCovers(), gameId]));
  const name = newImageName(gameId, "cover");
  let failure: Msg | null = null;
  try {
    await native.downloadCover(g.titleId, coverPath(name));
    replaceCover(gameId, name, "downloaded");
  } catch (error: any) {
    failure = errorMsg(error);
    updateGame(gameId, () => ({ coverLookupFailed: true }));
  }
  const next = new Set(downloadingCovers());
  next.delete(gameId);
  downloadingCovers.set(next);
  return failure;
}

/// The player picks a cover manually; non-16:9 images are center-cropped. Returns whether it was cropped
export async function setCover(gameId: string, image: string): Promise<boolean> {
  const name = newImageName(gameId, "cover");
  const cropped = await native.saveCover(image, coverPath(name));
  replaceCover(gameId, name, "manual");
  return cropped;
}

function replaceCover(gameId: string, name: string, source: CoverSource) {
  const old = game(gameId)?.coverFile;
  updateGame(gameId, () => ({ coverFile: name, coverSource: source, coverLookupFailed: false }));
  if (old && old !== name) native.removeFile(coverPath(old));
}

/// Applies the staged cover (a JPEG already cropped to 16:9) when "Save" is clicked in the editor sheet, keeping its source
export function applyCover(gameId: string, file: string, source: CoverSource) {
  const name = newImageName(gameId, "cover");
  native.moveFile(file, coverPath(name));
  replaceCover(gameId, name, source);
}

export function removeCover(gameId: string) {
  const g = game(gameId);
  if (!g?.coverFile) return;
  native.removeFile(coverPath(g.coverFile));
  updateGame(gameId, () => ({ coverFile: null, coverSource: null }));
}

export function removeGames(ids: string[]) {
  for (const id of ids) {
    cancel(id);
    removeGame(id);
  }
}

/// Demo mode: a finished conversion (successful, or failed at step failedAt), for viewing logs
export function injectMockHistory(gameId: string, log: LogLine[], failedAt: number | null = null, error: Msg | null = null) {
  const job = new Job(gameId);
  job.fileSize = game(gameId)?.fileSize ?? 0;
  job.steps.set(
    STEPS.map((_, i) =>
      failedAt == null ? { kind: "done", detail: "" } : i < failedAt ? { kind: "done", detail: "" } : i === failedAt ? { kind: "failed" } : { kind: "pending" },
    ),
  );
  job.state.set(error ? "failed" : "finished");
  job.error.set(error);
  log.forEach((line) => job.log.push(line));
  history.set({ ...history(), [gameId]: job });
}

/// Demo mode: one converting task (stuck at step 2, "Extract") + several queued tasks; nothing actually runs
export function injectMockJobs(running: string, waiting: string[], runningLog: LogLine[]) {
  if (!game(running)) return;
  const job = new Job(running);
  job.startedAt = Date.now() - 83_000;
  job.fileSize = game(running)!.fileSize;
  job.stepStartedAt = Date.now() - 40_000;
  job.state.set("running");
  job.steps.set(
    STEPS.map((_, i) =>
      i === 0 ? { kind: "done", detail: msg("step_identify_detail_base", game(running)?.titleId ?? "") } : i === 1 ? { kind: "running" } : { kind: "pending" },
    ),
  );
  job.currentStep.set(1);
  job.stepProgress.set(0.3);
  runningLog.forEach((line) => job.append(line));
  const all = [job, ...waiting.filter((id) => game(id)).map((id) => new Job(id))];
  const b = newBatch();
  b.startedAt = Date.now() - 83_000;
  for (const j of all) {
    b.total += 1;
    b.bytesTotal += game(j.gameId)?.fileSize ?? 0;
  }
  batch(() => {
    currentBatch.set(b);
    jobs.set(all);
  });
  changed();
}
