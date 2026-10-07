import type { Card, Recurrence } from './types.ts';
import { MAX_COMPLETIONS, WEEKDAY_LABELS, FREQ_LABELS } from './types.ts';

/**
 * Recurrence maths, done entirely on local-time date parts.
 *
 * Every calculation here goes through `new Date(y, m, d)` and `setDate` /
 * `setMonth`, never arithmetic on epoch milliseconds. Adding 86_400_000 ms to a
 * date works until the clocks change, at which point a "daily" card starts
 * resetting at 11pm or 1am. Date-part arithmetic is DST-safe because the
 * runtime resolves the wall-clock value for us.
 *
 * `dueAt` is stored as the ISO form of local midnight on the occurrence day.
 */

/** Local midnight of the day containing `d`. */
export function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** 'YYYY-MM-DD' in local time. Not `toISOString`, which converts to UTC. */
export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

export function daysInMonth(year: number, monthIndex: number): number {
  // Day 0 of the following month is the last day of this one.
  return new Date(year, monthIndex + 1, 0).getDate();
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() + n);
  return out;
}

/**
 * Shift by whole months, honouring `byMonthDay` so a card pinned to the 31st
 * clamps to the short month but recovers afterwards, instead of permanently
 * walking backwards to the 28th.
 */
function shiftMonths(d: Date, n: number, byMonthDay?: number): Date {
  const probe = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const wanted = byMonthDay ?? d.getDate();
  const day = Math.min(wanted, daysInMonth(probe.getFullYear(), probe.getMonth()));
  return new Date(probe.getFullYear(), probe.getMonth(), day);
}

function normalizedWeekdays(rec: Recurrence): number[] {
  const days = (rec.byWeekday ?? []).filter((d) => d >= 0 && d <= 6);
  return [...new Set(days)].sort((a, b) => a - b);
}

function step(rec: Recurrence): number {
  return Math.max(1, Math.floor(rec.interval || 1));
}

/**
 * The first occurrence strictly after `from`.
 *
 * `dir` of -1 walks backwards instead, which `streakFor` uses to enumerate past
 * periods without a second implementation of the calendar rules.
 */
export function nextOccurrence(rec: Recurrence, from: Date, dir: 1 | -1 = 1): Date {
  const base = startOfLocalDay(from);
  const n = step(rec);

  switch (rec.freq) {
    case 'daily':
      return addDays(base, dir * n);

    case 'weekly': {
      const weekdays = normalizedWeekdays(rec);
      if (weekdays.length === 0) return addDays(base, dir * 7 * n);
      // With specific weekdays the interval is ignored (see Recurrence docs):
      // walk day by day to the nearest selected weekday in the given direction.
      for (let i = 1; i <= 7; i += 1) {
        const candidate = addDays(base, dir * i);
        if (weekdays.includes(candidate.getDay())) return candidate;
      }
      return addDays(base, dir * 7);
    }

    case 'monthly':
      return shiftMonths(base, dir * n, rec.byMonthDay);

    case 'yearly': {
      const month = rec.byMonth ?? base.getMonth();
      const wantedDay = rec.byMonthDay ?? base.getDate();
      const build = (year: number): Date =>
        new Date(year, month, Math.min(wantedDay, daysInMonth(year, month)));

      let candidate = build(base.getFullYear() + dir * n);
      // `byMonth` can land the candidate on the wrong side of `base`; push on.
      if (dir === 1 && candidate.getTime() <= base.getTime()) {
        candidate = build(candidate.getFullYear() + n);
      } else if (dir === -1 && candidate.getTime() >= base.getTime()) {
        candidate = build(candidate.getFullYear() - n);
      }
      return candidate;
    }
  }
}

/** Describes a recurrence in words, for the card badge. */
export function describeRecurrence(rec: Recurrence): string {
  const n = step(rec);
  if (rec.freq === 'weekly') {
    const weekdays = normalizedWeekdays(rec);
    if (weekdays.length > 0) {
      return 'Weekly on ' + weekdays.map((d) => WEEKDAY_LABELS[d]).join(', ');
    }
  }
  const unit = FREQ_LABELS[rec.freq];
  return n === 1 ? 'Every ' + unit : 'Every ' + n + ' ' + unit + 's';
}

/**
 * Rolls a recurring card forward into the current period.
 *
 * Deliberately separate from completing a card. Ticking a card appends to
 * `completions` and sets `done`; only the arrival of the next period clears
 * `done` and the subtasks. Conflating the two either loses history or
 * double-counts a streak.
 *
 * Missed periods roll forward rather than piling up as overdue clones: a habit
 * skipped for three days is one card to do today, and the gap shows up in the
 * completion history and the broken streak.
 */
export function rollCardForward(card: Card, now: Date): Card {
  if (!card.recurrence || !card.dueAt) return card;

  let due = new Date(card.dueAt);
  if (Number.isNaN(due.getTime())) return card;

  let rolled = false;
  // Bounded so a corrupt recurrence can never spin forever.
  for (let guard = 0; guard < 2000; guard += 1) {
    const next = nextOccurrence(card.recurrence, due);
    if (next.getTime() <= due.getTime()) break; // non-advancing; bail out
    if (now.getTime() < next.getTime()) break;
    due = next;
    rolled = true;
  }
  if (!rolled) return card;

  return {
    ...card,
    dueAt: due.toISOString(),
    done: false,
    subtasks: card.subtasks.map((s) => (s.done ? { ...s, done: false } : s)),
    updatedAt: now.toISOString(),
  };
}

/** Applies `rollCardForward` across a board, reporting which cards changed. */
export function rollBoardForward(cards: Card[], now: Date): { cards: Card[]; changed: string[] } {
  const changed: string[] = [];
  const next = cards.map((card) => {
    if (card.deletedAt) return card;
    const rolled = rollCardForward(card, now);
    if (rolled !== card) changed.push(card.id);
    return rolled;
  });
  return { cards: next, changed };
}

/** Records a completion, newest first, capped. */
export function addCompletion(card: Card, now: Date): Card {
  const stamp = now.toISOString();
  return {
    ...card,
    done: true,
    completions: [stamp, ...card.completions].slice(0, MAX_COMPLETIONS),
    updatedAt: stamp,
  };
}

/**
 * Consecutive completed periods, counting back from the current one.
 *
 * The current period not being done yet does not break the streak - you may
 * simply not have got to it today - so counting starts at the previous period
 * in that case. Relies on `dueAt` already being rolled into the current period,
 * which `rollBoardForward` guarantees on load.
 */
export function streakFor(card: Card): number {
  if (!card.recurrence || !card.dueAt || card.completions.length === 0) return 0;

  const due = new Date(card.dueAt);
  if (Number.isNaN(due.getTime())) return 0;

  const stamps = card.completions
    .map((c) => new Date(c).getTime())
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => b - a);
  if (stamps.length === 0) return 0;
  const oldest = stamps[stamps.length - 1];

  const completedIn = (start: Date, end: Date): boolean =>
    stamps.some((t) => t >= start.getTime() && t < end.getTime());

  let streak = 0;
  let periodStart = due;
  let periodEnd = nextOccurrence(card.recurrence, due);

  // The in-progress period only counts if it is already done.
  if (!completedIn(periodStart, periodEnd)) {
    periodEnd = periodStart;
    periodStart = nextOccurrence(card.recurrence, periodStart, -1);
  }

  for (let guard = 0; guard < MAX_COMPLETIONS + 1; guard += 1) {
    if (!completedIn(periodStart, periodEnd)) break;
    streak += 1;
    periodEnd = periodStart;
    periodStart = nextOccurrence(card.recurrence, periodStart, -1);
    if (periodStart.getTime() >= periodEnd.getTime()) break;
    // Walked back past every recorded completion; nothing left to find.
    if (periodEnd.getTime() <= oldest) break;
  }

  return streak;
}

/** Is this card's current occurrence in the past? */
export function isOverdue(card: Card, now: Date): boolean {
  if (card.done || !card.dueAt) return false;
  const due = new Date(card.dueAt);
  if (Number.isNaN(due.getTime())) return false;
  return startOfLocalDay(now).getTime() > startOfLocalDay(due).getTime();
}

/** Is this card's current occurrence today? */
export function isDueToday(card: Card, now: Date): boolean {
  if (!card.dueAt) return false;
  const due = new Date(card.dueAt);
  if (Number.isNaN(due.getTime())) return false;
  return localDateKey(due) === localDateKey(now);
}

/** Local-midnight ISO string for a 'YYYY-MM-DD' value from a date input. */
export function dateKeyToIso(key: string): string | null {
  const parts = key.split('-').map((p) => Number.parseInt(p, 10));
  const [y, m, d] = parts;
  if (!y || !m || !d || Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return null;
  return new Date(y, m - 1, d).toISOString();
}

/** Inverse of `dateKeyToIso`, for populating a date input. */
export function isoToDateKey(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return localDateKey(d);
}
