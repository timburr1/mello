import { describe, expect, it } from 'vitest';
import { isNewer, normalizeItem, readPrincipal } from './model';
import type { StoredItem } from './model';

const USER = 'aad|tim';

function stored(updatedAt: string): StoredItem {
  return { id: 'a', type: 'card', userId: USER, updatedAt, deletedAt: null };
}

describe('normalizeItem', () => {
  it('accepts a well-formed card', () => {
    const item = normalizeItem(
      {
        id: 'c1',
        type: 'card',
        listId: 'l1',
        title: 'Water plants',
        description: 'the ferns',
        position: 1000,
        done: true,
        updatedAt: '2026-03-14T10:00:00.000Z',
        deletedAt: null,
        subtasks: [{ id: 's1', text: 'fill can', done: false }],
        recurrence: { freq: 'daily', interval: 2 },
        dueAt: '2026-03-15T06:00:00.000Z',
        completions: ['2026-03-13T10:00:00.000Z'],
      },
      USER,
    );
    expect(item?.title).toBe('Water plants');
    expect(item?.subtasks).toHaveLength(1);
  });

  it('takes userId from the principal, never the body', () => {
    const item = normalizeItem(
      {
        id: 'c1',
        type: 'card',
        listId: 'l1',
        userId: 'somebody-else',
        updatedAt: '2026-03-14T10:00:00.000Z',
      },
      USER,
    );
    expect(item?.userId).toBe(USER);
  });

  it('normalises timestamps to fixed-width UTC', () => {
    // The `since` filter compares updatedAt as a string in Cosmos SQL, so a
    // value carrying an offset would sort wrongly for the life of the row.
    const item = normalizeItem(
      { id: 'c1', type: 'card', listId: 'l1', updatedAt: '2026-03-14T11:00:00+01:00' },
      USER,
    );
    expect(item?.updatedAt).toBe('2026-03-14T10:00:00.000Z');
  });

  it('drops entries it cannot store', () => {
    expect(normalizeItem(null, USER)).toBeNull();
    expect(normalizeItem({ type: 'card', listId: 'l1', updatedAt: '2026-03-14T10:00:00Z' }, USER)).toBeNull();
    expect(normalizeItem({ id: 'c1', type: 'card', updatedAt: '2026-03-14T10:00:00Z' }, USER)).toBeNull();
    expect(normalizeItem({ id: 'c1', type: 'card', listId: 'l1', updatedAt: 'nope' }, USER)).toBeNull();
    expect(normalizeItem({ id: 'x', type: 'something', updatedAt: '2026-03-14T10:00:00Z' }, USER)).toBeNull();
  });

  it('clamps oversized text so one client cannot write an unstorable document', () => {
    const item = normalizeItem(
      {
        id: 'c1',
        type: 'card',
        listId: 'l1',
        title: 'x'.repeat(5000),
        description: 'y'.repeat(50_000),
        updatedAt: '2026-03-14T10:00:00.000Z',
      },
      USER,
    );
    expect((item?.title as string).length).toBe(500);
    expect((item?.description as string).length).toBe(20_000);
  });

  it('caps completion history', () => {
    const completions = Array.from({ length: 500 }, (_, i) =>
      new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
    );
    const item = normalizeItem(
      { id: 'c1', type: 'card', listId: 'l1', updatedAt: '2026-03-14T10:00:00.000Z', completions },
      USER,
    );
    expect((item?.completions as string[]).length).toBe(365);
  });

  it('rejects a recurrence with an unknown frequency', () => {
    const item = normalizeItem(
      {
        id: 'c1',
        type: 'card',
        listId: 'l1',
        updatedAt: '2026-03-14T10:00:00.000Z',
        recurrence: { freq: 'hourly', interval: 1 },
      },
      USER,
    );
    expect(item?.recurrence).toBeNull();
  });

  it('keeps a tombstone', () => {
    const item = normalizeItem(
      {
        id: 'c1',
        type: 'card',
        listId: 'l1',
        updatedAt: '2026-03-14T11:00:00.000Z',
        deletedAt: '2026-03-14T11:00:00.000Z',
      },
      USER,
    );
    expect(item?.deletedAt).toBe('2026-03-14T11:00:00.000Z');
  });
});

describe('isNewer', () => {
  it('is true with nothing stored', () => {
    expect(isNewer(stored('2026-03-14T10:00:00.000Z'), undefined)).toBe(true);
  });

  it('is true for a later write', () => {
    expect(isNewer(stored('2026-03-14T11:00:00.000Z'), stored('2026-03-14T10:00:00.000Z'))).toBe(
      true,
    );
  });

  it('is false for a stale write, so a slow device cannot clobber a newer edit', () => {
    expect(isNewer(stored('2026-03-14T09:00:00.000Z'), stored('2026-03-14T10:00:00.000Z'))).toBe(
      false,
    );
  });

  it('keeps the stored copy on an exact tie', () => {
    const t = '2026-03-14T10:00:00.000Z';
    expect(isNewer(stored(t), stored(t))).toBe(false);
  });
});

describe('readPrincipal', () => {
  it('decodes the Static Web Apps header', () => {
    const header = Buffer.from(
      JSON.stringify({
        userId: USER,
        userDetails: 'timburr1',
        identityProvider: 'github',
        userRoles: ['authenticated'],
      }),
    ).toString('base64');
    expect(readPrincipal(header)?.userId).toBe(USER);
    expect(readPrincipal(header)?.userRoles).toContain('authenticated');
  });

  it('refuses anything without a userId', () => {
    expect(readPrincipal(null)).toBeNull();
    expect(readPrincipal('')).toBeNull();
    expect(readPrincipal('not-base64-json')).toBeNull();
    expect(readPrincipal(Buffer.from('{}').toString('base64'))).toBeNull();
    expect(
      readPrincipal(Buffer.from(JSON.stringify({ userDetails: 'x' })).toString('base64')),
    ).toBeNull();
  });
});
