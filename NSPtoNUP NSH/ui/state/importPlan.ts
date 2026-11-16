// Adding files or folders: identified contents grouped by game.
// Grouping rule: equal Title ID & ~0x1FFF means the same game (update …800, DLC …1001–…1FFF).

import { L, msg } from "../i18n";
import type { NspContent } from "../native";
import { contents, dlcsOf, games, updateOf, type Skip } from "./library";

/// Maximum number of NSPs added at once
export const SCAN_LIMIT = 500;

/// Title ID of the owning base game
export function baseTitleId(titleId: string): string {
  // ~0x1FFF only affects the last 4 hex digits (16 bits): no 64-bit integers needed
  const id = titleId.toUpperCase().padStart(16, "0");
  const low = parseInt(id.slice(12), 16) & 0xe000;
  return id.slice(0, 12) + low.toString(16).toUpperCase().padStart(4, "0");
}

/// One game: a new base game (added to the game library), or an existing game (only adding updates / DLC)
export interface ImportGroup {
  baseTitleId: string;
  base: NspContent | null;
  /// A game already in the game library
  existingGameId: string | null;
  update: NspContent | null;
  dlcs: NspContent[];
}

export const extrasOf = (group: ImportGroup): NspContent[] => [...(group.update ? [group.update] : []), ...group.dlcs];
export const groupSize = (group: ImportGroup) => (group.base?.size ?? 0) + extrasOf(group).reduce((s, c) => s + c.size, 0);

export interface ImportPlan {
  groups: ImportGroup[];
  skipped: Skip[];
}

export const fileCount = (plan: ImportPlan) =>
  plan.groups.reduce((n, g) => n + (g.base ? 1 : 0) + extrasOf(g).length, 0);

/// Existing games in the game library: base Title ID → (game id, existing update version, existing DLC Title IDs)
function existingGames() {
  const map = new Map<string, { id: string; updateVersion: number | null; dlcs: Set<string> }>();
  for (const g of games()) {
    if (!g.titleId) continue;
    map.set(baseTitleId(g.titleId), {
      id: g.id,
      updateVersion: updateOf(g)?.version ?? null,
      dlcs: new Set(dlcsOf(g).map((d) => d.titleId.toUpperCase())),
    });
  }
  return map;
}

export function makePlan(identified: NspContent[], failures: Skip[]): ImportPlan {
  const existing = existingGames();
  const known = new Set(games().flatMap((g) => [g.nspPath, ...contents(g).map((c) => c.nspPath)]));
  const skipped: Skip[] = [...failures];
  const groups = new Map<string, ImportGroup>();

  for (const content of identified) {
    if (known.has(content.path)) {
      skipped.push([content.path, msg("skip_already_in_library")]);
      continue;
    }
    const key = baseTitleId(content.titleId);
    let group = groups.get(key);
    if (!group) {
      group = { baseTitleId: key, base: null, existingGameId: existing.get(key)?.id ?? null, update: null, dlcs: [] };
      groups.set(key, group);
    }
    switch (content.kind) {
      case "base":
        if (group.existingGameId) skipped.push([content.path, msg("skip_game_in_library")]);
        else if (group.base) skipped.push([content.path, msg("skip_duplicate_base")]);
        else group.base = content;
        break;
      case "update": {
        const current = Math.max(group.update?.version ?? 0, existing.get(key)?.updateVersion ?? 0);
        if (content.version <= current) {
          skipped.push([content.path, msg("skip_newer_version_exists")]);
        } else {
          if (group.update) skipped.push([group.update.path, msg("skip_newer_version_exists")]);
          group.update = content;
        }
        break;
      }
      case "dlc": {
        if (existing.get(key)?.dlcs.has(content.titleId.toUpperCase())) {
          skipped.push([content.path, msg("skip_dlc_already_added")]);
          break;
        }
        const index = group.dlcs.findIndex((d) => d.titleId === content.titleId);
        if (index < 0) group.dlcs.push(content);
        else if (content.version > group.dlcs[index].version) {
          // For the same DLC, keep the newer version
          skipped.push([group.dlcs[index].path, msg("skip_newer_version_exists")]);
          group.dlcs[index] = content;
        } else {
          skipped.push([content.path, msg("skip_newer_version_exists")]);
        }
        break;
      }
    }
  }

  const result: ImportGroup[] = [];
  for (const group of groups.values()) {
    group.dlcs.sort((a, b) => (a.titleId < b.titleId ? -1 : 1));
    if (!group.base && !group.existingGameId) {
      // Only updates / DLC, no base game found
      for (const content of extrasOf(group)) skipped.push([content.path, msg("skip_base_not_found")]);
      continue;
    }
    if (!group.base && !extrasOf(group).length) continue;
    result.push(group);
  }
  return { groups: result, skipped };
}

/// Contents summary: base game + update v1.0 + 1 DLC; existing game: update v1.2.1 → added to the existing game
export function groupSummary(group: ImportGroup, updateVersion: string | null): string {
  const parts: string[] = [];
  if (group.base) parts.push(L("content_kind_base"));
  if (group.update) {
    const version = updateVersion ? `v${updateVersion}` : L("content_revision", group.update.version >>> 16);
    parts.push(`${L("content_kind_update")} ${version}`);
  }
  if (group.dlcs.length) parts.push(L("content_dlc_count", group.dlcs.length));
  return parts.join(" + ") + (group.existingGameId ? ` → ${L("import_attach_existing")}` : "");
}
