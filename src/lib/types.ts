/**
 * Shared data model. Imported by both the client (`src/`) and the API (`api/`),
 * so it must stay free of browser- and Node-specific imports.
 *
 * Every syncable entity carries `updatedAt` (drives last-write-wins merging) and
 * `deletedAt` (a tombstone, so a delete on one device is not resurrected by the
 * other device's next push).
 */

export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface Recurrence {
  freq: RecurrenceFreq;
  /** Repeat every N periods. Ignored when `byWeekday` is set. */
  interval: number;
  /** 0 = Sunday .. 6 = Saturday. Weekly only, e.g. "every Mon + Wed". */
  byWeekday?: number[];
  /**
   * Day of month 1-31, monthly/yearly only. Held separately from the due date
   * so intent survives clamping: a card set to the 31st lands on Feb 28 in
   * February but returns to the 31st in March.
   */
  byMonthDay?: number;
  /** Month 0-11, yearly only. */
  byMonth?: number;
}

export interface Subtask {
  id: string;
  text: string;
  done: boolean;
}

export interface BoardList {
  id: string;
  type: 'list';
  userId: string;
  name: string;
  position: number;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Card {
  id: string;
  type: 'card';
  userId: string;
  listId: string;
  position: number;
  title: string;
  description: string;
  subtasks: Subtask[];
  done: boolean;
  recurrence: Recurrence | null;
  /** ISO timestamp at local midnight of the current occurrence. */
  dueAt: string | null;
  /** ISO completion timestamps, newest first, capped at MAX_COMPLETIONS. */
  completions: string[];
  updatedAt: string;
  deletedAt: string | null;
}

export type Item = BoardList | Card;

export interface Board {
  lists: BoardList[];
  cards: Card[];
}

/** Keeps a long-running daily habit's document small; ample for streaks. */
export const MAX_COMPLETIONS = 365;

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const FREQ_LABELS: Record<RecurrenceFreq, string> = {
  daily: 'day',
  weekly: 'week',
  monthly: 'month',
  yearly: 'year',
};

export function isCard(item: Item): item is Card {
  return item.type === 'card';
}

export function isList(item: Item): item is BoardList {
  return item.type === 'list';
}

export function emptyBoard(): Board {
  return { lists: [], cards: [] };
}
