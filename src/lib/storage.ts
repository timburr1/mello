import type { Board, BoardList, Card, Item, Recurrence, Subtask } from './types.ts';
import { emptyBoard } from './types.ts';

/**
 * localStorage is the working copy: every read and write the UI does goes here,
 * which is what makes the board instant and usable with no signal. Azure is a
 * sync target, not the read path.
 *
 * Everything is wrapped in try/catch because localStorage throws outright in
 * private-browsing modes and when site data is blocked, and every value that
 * comes back is re-validated: the store survives a browser restart, a half
 * written sync, and an older version of this app, so it cannot be trusted to
 * match the current types.
 */

const BOARD_KEY = 'mello.board.v1';
const META_KEY = 'mello.sync.v1';

/** A tombstone has to outlive any plausible offline stretch, or the other
 *  device's next push resurrects the card. Three months is ample. */
const TOMBSTONE_TTL_DAYS = 90;

export interface SyncMeta {
  /** ISO timestamp of the newest item the server has confirmed. */
  lastSyncedAt: string | null;
  /** Ids edited locally and not yet accepted by the server. */
  dirty: string[];
}

export function emptySyncMeta(): SyncMeta {
  return { lastSyncedAt: null, dirty: [] };
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : value;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function coerceRecurrence(value: unknown): Recurrence | null {
  const raw = record(value);
  if (!raw) return null;
  const freq = str(raw.freq);
  if (freq !== 'daily' && freq !== 'weekly' && freq !== 'monthly' && freq !== 'yearly') {
    return null;
  }
  const rec: Recurrence = { freq, interval: Math.max(1, Math.floor(num(raw.interval, 1))) };
  if (Array.isArray(raw.byWeekday)) {
    const days = raw.byWeekday
      .filter((d): d is number => typeof d === 'number' && d >= 0 && d <= 6)
      .map((d) => Math.floor(d));
    if (days.length > 0) rec.byWeekday = [...new Set(days)].sort((a, b) => a - b);
  }
  if (typeof raw.byMonthDay === 'number' && raw.byMonthDay >= 1 && raw.byMonthDay <= 31) {
    rec.byMonthDay = Math.floor(raw.byMonthDay);
  }
  if (typeof raw.byMonth === 'number' && raw.byMonth >= 0 && raw.byMonth <= 11) {
    rec.byMonth = Math.floor(raw.byMonth);
  }
  return rec;
}

function coerceSubtasks(value: unknown): Subtask[] {
  if (!Array.isArray(value)) return [];
  const out: Subtask[] = [];
  for (const entry of value) {
    const raw = record(entry);
    if (!raw) continue;
    const id = str(raw.id);
    if (!id) continue;
    out.push({ id, text: str(raw.text), done: bool(raw.done) });
  }
  return out;
}

function coerceCompletions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((c) => isoOrNull(c))
    .filter((c): c is string => c !== null)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
}

const EPOCH = new Date(0).toISOString();

export function coerceList(value: unknown): BoardList | null {
  const raw = record(value);
  if (!raw) return null;
  const id = str(raw.id);
  if (!id) return null;
  return {
    id,
    type: 'list',
    userId: str(raw.userId),
    name: str(raw.name, 'Untitled'),
    position: num(raw.position),
    updatedAt: isoOrNull(raw.updatedAt) ?? EPOCH,
    deletedAt: isoOrNull(raw.deletedAt),
  };
}

export function coerceCard(value: unknown): Card | null {
  const raw = record(value);
  if (!raw) return null;
  const id = str(raw.id);
  const listId = str(raw.listId);
  if (!id || !listId) return null;
  return {
    id,
    type: 'card',
    userId: str(raw.userId),
    listId,
    position: num(raw.position),
    title: str(raw.title),
    description: str(raw.description),
    subtasks: coerceSubtasks(raw.subtasks),
    done: bool(raw.done),
    recurrence: coerceRecurrence(raw.recurrence),
    dueAt: isoOrNull(raw.dueAt),
    completions: coerceCompletions(raw.completions),
    updatedAt: isoOrNull(raw.updatedAt) ?? EPOCH,
    deletedAt: isoOrNull(raw.deletedAt),
  };
}

/** Normalises anything claiming to be an Item, discarding what cannot be saved. */
export function coerceItem(value: unknown): Item | null {
  const raw = record(value);
  if (!raw) return null;
  return raw.type === 'list' ? coerceList(raw) : coerceCard(raw);
}

/** Rebuilds a board from untrusted JSON, dropping unsalvageable entries. */
export function coerceBoard(value: unknown): Board {
  const raw = record(value);
  if (!raw) return emptyBoard();
  const lists = Array.isArray(raw.lists)
    ? raw.lists.map(coerceList).filter((l): l is BoardList => l !== null)
    : [];
  const cards = Array.isArray(raw.cards)
    ? raw.cards.map(coerceCard).filter((c): c is Card => c !== null)
    : [];
  // A card pointing at a list that no longer exists would be invisible and
  // unreachable, so re-home it on the first list rather than losing it.
  const liveListIds = new Set(lists.filter((l) => !l.deletedAt).map((l) => l.id));
  const fallbackList = lists.find((l) => !l.deletedAt)?.id;
  const repaired = cards.map((c) => {
    if (liveListIds.has(c.listId) || c.deletedAt || !fallbackList) return c;
    return { ...c, listId: fallbackList };
  });
  return { lists, cards: repaired };
}

export function loadBoard(): Board {
  try {
    const raw = localStorage.getItem(BOARD_KEY);
    if (!raw) return emptyBoard();
    return coerceBoard(JSON.parse(raw));
  } catch {
    return emptyBoard();
  }
}

export function saveBoard(board: Board): void {
  try {
    localStorage.setItem(BOARD_KEY, JSON.stringify(board));
  } catch {
    // Quota exhausted or storage blocked. The in-memory board still works for
    // this session; nothing is gained by breaking the render over it.
  }
}

export function loadSyncMeta(): SyncMeta {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return emptySyncMeta();
    const parsed = record(JSON.parse(raw));
    if (!parsed) return emptySyncMeta();
    return {
      lastSyncedAt: isoOrNull(parsed.lastSyncedAt),
      dirty: Array.isArray(parsed.dirty) ? parsed.dirty.filter((d) => typeof d === 'string') : [],
    };
  } catch {
    return emptySyncMeta();
  }
}

export function saveSyncMeta(meta: SyncMeta): void {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    // See saveBoard.
  }
}

/**
 * Drops tombstones old enough that no device could still be carrying the live
 * card, keeping localStorage from growing without bound.
 */
export function pruneTombstones(board: Board, now: Date): Board {
  const cutoff = now.getTime() - TOMBSTONE_TTL_DAYS * 24 * 60 * 60 * 1000;
  const expired = (item: Item): boolean =>
    item.deletedAt !== null && new Date(item.deletedAt).getTime() < cutoff;
  return {
    lists: board.lists.filter((l) => !expired(l)),
    cards: board.cards.filter((c) => !expired(c)),
  };
}

export interface ExportFile {
  app: 'mello';
  version: 1;
  exportedAt: string;
  board: Board;
}

export function exportBoard(board: Board, now: Date): string {
  const payload: ExportFile = {
    app: 'mello',
    version: 1,
    exportedAt: now.toISOString(),
    board,
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Reads an export file back. Accepts either the wrapper or a bare board so a
 * hand-edited file still imports.
 */
export function parseImport(text: string): { board: Board } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: 'That file is not valid JSON.' };
  }
  const raw = record(parsed);
  if (!raw) return { error: 'That file does not contain a board.' };
  const source = record(raw.board) ?? raw;
  const board = coerceBoard(source);
  if (board.lists.length === 0 && board.cards.length === 0) {
    return { error: 'No lists or cards found in that file.' };
  }
  return { board };
}
