import { describe, expect, it } from 'vitest';
import type { Card, Recurrence } from './types.ts';
import {
  addCompletion,
  daysInMonth,
  isOverdue,
  localDateKey,
  nextOccurrence,
  rollCardForward,
  streakFor,
} from './recurrence.ts';

/**
 * These tests avoid asserting absolute UTC instants wherever possible, because
 * that would only prove the maths for whoever's timezone CI happens to run in.
 * Instead they assert local-time invariants (midnight, consecutive date keys)
 * which hold in every zone but only pass if the arithmetic is DST-safe.
 * `vite.config.ts` also pins TZ to America/Denver so DST is genuinely exercised.
 */

function at(y: number, m: number, d: number): Date {
  return new Date(y, m - 1, d);
}

function card(partial: Partial<Card> = {}): Card {
  return {
    id: 'c1',
    type: 'card',
    userId: 'u1',
    listId: 'l1',
    position: 0,
    title: 'Water plants',
    description: '',
    subtasks: [],
    done: false,
    recurrence: null,
    dueAt: null,
    completions: [],
    updatedAt: at(2026, 1, 1).toISOString(),
    deletedAt: null,
    ...partial,
  };
}

const daily: Recurrence = { freq: 'daily', interval: 1 };

describe('test environment', () => {
  it('runs in a DST-observing timezone', () => {
    // If this fails the suite still passes everywhere else, but the DST cases
    // below would be proving nothing. vite.config.ts sets TZ for exactly this.
    const january = at(2026, 1, 1).getTimezoneOffset();
    const july = at(2026, 7, 1).getTimezoneOffset();
    expect(january).not.toBe(july);
  });
});

describe('nextOccurrence', () => {
  it('advances a daily card by one local day', () => {
    const next = nextOccurrence(daily, at(2026, 3, 14));
    expect(localDateKey(next)).toBe('2026-03-15');
    expect(next.getHours()).toBe(0);
  });

  it('honours an interval greater than one', () => {
    expect(localDateKey(nextOccurrence({ freq: 'daily', interval: 3 }, at(2026, 3, 1)))).toBe(
      '2026-03-04',
    );
  });

  it('stays at local midnight across a DST transition', () => {
    // US DST springs forward 8 Mar 2026 and falls back 1 Nov 2026. Stepping a
    // daily card through both must never drift to 23:00 or 01:00.
    for (const start of [at(2026, 3, 6), at(2026, 10, 30)]) {
      let cursor = start;
      const keys: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        cursor = nextOccurrence(daily, cursor);
        expect(cursor.getHours()).toBe(0);
        expect(cursor.getMinutes()).toBe(0);
        keys.push(localDateKey(cursor));
      }
      expect(new Set(keys).size).toBe(5);
    }
  });

  it('clamps a monthly card pinned to the 31st, then recovers', () => {
    const monthly: Recurrence = { freq: 'monthly', interval: 1, byMonthDay: 31 };
    const feb = nextOccurrence(monthly, at(2026, 1, 31));
    expect(localDateKey(feb)).toBe('2026-02-28');
    // The intent survives the clamp: March returns to the 31st rather than
    // walking permanently backwards to the 28th.
    const mar = nextOccurrence(monthly, feb);
    expect(localDateKey(mar)).toBe('2026-03-31');
  });

  it('clamps 29 February on a non-leap year', () => {
    const yearly: Recurrence = { freq: 'yearly', interval: 1, byMonth: 1, byMonthDay: 29 };
    expect(localDateKey(nextOccurrence(yearly, at(2024, 2, 29)))).toBe('2025-02-28');
  });

  it('walks to the next selected weekday', () => {
    const monWed: Recurrence = { freq: 'weekly', interval: 1, byWeekday: [1, 3] };
    // 2026-03-09 is a Monday.
    expect(localDateKey(nextOccurrence(monWed, at(2026, 3, 9)))).toBe('2026-03-11');
    expect(localDateKey(nextOccurrence(monWed, at(2026, 3, 11)))).toBe('2026-03-16');
  });

  it('walks backwards when asked', () => {
    expect(localDateKey(nextOccurrence(daily, at(2026, 3, 15), -1))).toBe('2026-03-14');
    const monWed: Recurrence = { freq: 'weekly', interval: 1, byWeekday: [1, 3] };
    expect(localDateKey(nextOccurrence(monWed, at(2026, 3, 11), -1))).toBe('2026-03-09');
  });

  it('knows how long each month is', () => {
    expect(daysInMonth(2026, 1)).toBe(28);
    expect(daysInMonth(2024, 1)).toBe(29);
    expect(daysInMonth(2026, 3)).toBe(30);
  });
});

describe('rollCardForward', () => {
  it('leaves a card alone inside its current period', () => {
    const c = card({ recurrence: daily, dueAt: at(2026, 3, 14).toISOString(), done: true });
    expect(rollCardForward(c, at(2026, 3, 14))).toBe(c);
  });

  it('clears done and resets subtasks at the period boundary', () => {
    const c = card({
      recurrence: daily,
      dueAt: at(2026, 3, 14).toISOString(),
      done: true,
      subtasks: [
        { id: 's1', text: 'fill can', done: true },
        { id: 's2', text: 'ferns', done: true },
      ],
    });
    const rolled = rollCardForward(c, at(2026, 3, 15));
    expect(rolled.done).toBe(false);
    expect(rolled.subtasks.every((s) => !s.done)).toBe(true);
    expect(localDateKey(new Date(String(rolled.dueAt)))).toBe('2026-03-15');
  });

  it('collapses many missed periods into the current one', () => {
    // Three weeks untouched should leave one card due today, not 21 overdue.
    const c = card({ recurrence: daily, dueAt: at(2026, 3, 1).toISOString() });
    const rolled = rollCardForward(c, at(2026, 3, 22));
    expect(localDateKey(new Date(String(rolled.dueAt)))).toBe('2026-03-22');
    expect(rolled.done).toBe(false);
  });

  it('ignores cards with no recurrence', () => {
    const c = card({ dueAt: at(2020, 1, 1).toISOString() });
    expect(rollCardForward(c, at(2026, 3, 22))).toBe(c);
  });

  it('survives a corrupt dueAt', () => {
    const c = card({ recurrence: daily, dueAt: 'not-a-date' });
    expect(rollCardForward(c, at(2026, 3, 22))).toBe(c);
  });
});

describe('streakFor', () => {
  it('counts consecutive completed days', () => {
    const c = card({
      recurrence: daily,
      dueAt: at(2026, 3, 14).toISOString(),
      completions: [
        at(2026, 3, 14).toISOString(),
        at(2026, 3, 13).toISOString(),
        at(2026, 3, 12).toISOString(),
      ],
    });
    expect(streakFor(c)).toBe(3);
  });

  it('does not break the streak just because today is not done yet', () => {
    const c = card({
      recurrence: daily,
      dueAt: at(2026, 3, 14).toISOString(),
      completions: [at(2026, 3, 13).toISOString(), at(2026, 3, 12).toISOString()],
    });
    expect(streakFor(c)).toBe(2);
  });

  it('stops at a gap', () => {
    const c = card({
      recurrence: daily,
      dueAt: at(2026, 3, 14).toISOString(),
      completions: [
        at(2026, 3, 14).toISOString(),
        at(2026, 3, 13).toISOString(),
        // 12th missed
        at(2026, 3, 11).toISOString(),
      ],
    });
    expect(streakFor(c)).toBe(2);
  });

  it('is zero with no history', () => {
    expect(streakFor(card({ recurrence: daily, dueAt: at(2026, 3, 14).toISOString() }))).toBe(0);
  });

  it('counts weekly periods, not days', () => {
    const weekly: Recurrence = { freq: 'weekly', interval: 1 };
    const c = card({
      recurrence: weekly,
      dueAt: at(2026, 3, 9).toISOString(),
      completions: [
        at(2026, 3, 10).toISOString(),
        at(2026, 3, 3).toISOString(),
        at(2026, 2, 24).toISOString(),
      ],
    });
    expect(streakFor(c)).toBe(3);
  });
});

describe('addCompletion', () => {
  it('records newest first and marks done', () => {
    const c = addCompletion(card({ recurrence: daily }), at(2026, 3, 14));
    expect(c.done).toBe(true);
    expect(c.completions).toHaveLength(1);
    const later = addCompletion(c, at(2026, 3, 15));
    expect(new Date(later.completions[0]).getTime()).toBeGreaterThan(
      new Date(later.completions[1]).getTime(),
    );
  });

  it('caps the history so a long-running habit stays small', () => {
    const many = Array.from({ length: 400 }, (_, i) =>
      new Date(2026, 0, 1, 0, 0, i).toISOString(),
    );
    const c = addCompletion(card({ completions: many }), at(2026, 3, 14));
    expect(c.completions).toHaveLength(365);
  });
});

describe('isOverdue', () => {
  it('is true for a past due date that is not done', () => {
    const c = card({ recurrence: daily, dueAt: at(2026, 3, 13).toISOString() });
    expect(isOverdue(c, at(2026, 3, 14))).toBe(true);
  });

  it('is false once done', () => {
    const c = card({ recurrence: daily, dueAt: at(2026, 3, 13).toISOString(), done: true });
    expect(isOverdue(c, at(2026, 3, 14))).toBe(false);
  });

  it('is false on the due day itself', () => {
    const c = card({ dueAt: at(2026, 3, 14).toISOString() });
    expect(isOverdue(c, at(2026, 3, 14))).toBe(false);
  });
});
