import { describe, expect, it } from 'vitest';
import type { Board, Card } from './types.ts';
import { boardFromItems, collectDirty, mergeBoards, positionBetween, visibleCards } from './merge.ts';

function card(id: string, updatedAt: string, extra: Partial<Card> = {}): Card {
  return {
    id,
    type: 'card',
    userId: 'u1',
    listId: 'l1',
    position: 0,
    title: id,
    description: '',
    subtasks: [],
    done: false,
    recurrence: null,
    dueAt: null,
    completions: [],
    updatedAt,
    deletedAt: null,
    ...extra,
  };
}

function board(cards: Card[]): Board {
  return { lists: [], cards };
}

describe('mergeBoards', () => {
  it('keeps the newer edit', () => {
    const local = board([card('a', '2026-03-14T10:00:00.000Z', { title: 'local' })]);
    const remote = board([card('a', '2026-03-14T11:00:00.000Z', { title: 'remote' })]);
    expect(mergeBoards(local, remote).cards[0].title).toBe('remote');
  });

  it('keeps the local edit when it is the newer one', () => {
    const local = board([card('a', '2026-03-14T12:00:00.000Z', { title: 'local' })]);
    const remote = board([card('a', '2026-03-14T11:00:00.000Z', { title: 'remote' })]);
    expect(mergeBoards(local, remote).cards[0].title).toBe('local');
  });

  it('prefers local on an exact tie, protecting the unsynced edit', () => {
    const stamp = '2026-03-14T12:00:00.000Z';
    const local = board([card('a', stamp, { title: 'local' })]);
    const remote = board([card('a', stamp, { title: 'remote' })]);
    expect(mergeBoards(local, remote).cards[0].title).toBe('local');
  });

  it('unions cards that only exist on one side', () => {
    const local = board([card('a', '2026-03-14T10:00:00.000Z')]);
    const remote = board([card('b', '2026-03-14T10:00:00.000Z')]);
    const merged = mergeBoards(local, remote);
    expect(merged.cards.map((c) => c.id).sort()).toEqual(['a', 'b']);
  });

  it('does not resurrect a card deleted more recently elsewhere', () => {
    // The phone deleted it at 11:00; the desktop still has its 10:00 copy.
    const local = board([card('a', '2026-03-14T10:00:00.000Z')]);
    const remote = board([
      card('a', '2026-03-14T11:00:00.000Z', { deletedAt: '2026-03-14T11:00:00.000Z' }),
    ]);
    const merged = mergeBoards(local, remote);
    expect(merged.cards[0].deletedAt).toBe('2026-03-14T11:00:00.000Z');
    expect(visibleCards(merged, 'l1')).toHaveLength(0);
  });

  it('lets a later edit win over an earlier delete', () => {
    const local = board([card('a', '2026-03-14T12:00:00.000Z', { title: 'revived on purpose' })]);
    const remote = board([
      card('a', '2026-03-14T11:00:00.000Z', { deletedAt: '2026-03-14T11:00:00.000Z' }),
    ]);
    expect(mergeBoards(local, remote).cards[0].deletedAt).toBeNull();
  });

  it('ignores a corrupt timestamp rather than letting it win', () => {
    const local = board([card('a', '2026-03-14T10:00:00.000Z', { title: 'local' })]);
    const remote = board([card('a', 'garbage', { title: 'remote' })]);
    expect(mergeBoards(local, remote).cards[0].title).toBe('local');
  });
});

describe('collectDirty', () => {
  it('returns only the flagged items', () => {
    const b = board([
      card('a', '2026-03-14T10:00:00.000Z'),
      card('b', '2026-03-14T10:00:00.000Z'),
    ]);
    expect(collectDirty(b, ['b']).map((i) => i.id)).toEqual(['b']);
  });

  it('is empty when nothing is dirty', () => {
    expect(collectDirty(board([card('a', '2026-03-14T10:00:00.000Z')]), [])).toEqual([]);
  });
});

describe('boardFromItems', () => {
  it('splits lists from cards', () => {
    const result = boardFromItems([
      {
        id: 'l1',
        type: 'list',
        userId: 'u1',
        name: 'Todo',
        position: 0,
        updatedAt: '2026-03-14T10:00:00.000Z',
        deletedAt: null,
      },
      card('a', '2026-03-14T10:00:00.000Z'),
    ]);
    expect(result.lists).toHaveLength(1);
    expect(result.cards).toHaveLength(1);
  });
});

describe('positionBetween', () => {
  it('places a card between two neighbours', () => {
    expect(positionBetween(1000, 2000)).toBe(1500);
  });

  it('handles the ends of a list', () => {
    expect(positionBetween(null, 1000)).toBe(0);
    expect(positionBetween(1000, null)).toBe(2000);
    expect(positionBetween(null, null)).toBe(1000);
  });

  it('keeps ordering strict so a reorder touches one card', () => {
    const mid = positionBetween(1000, 1001);
    expect(mid).toBeGreaterThan(1000);
    expect(mid).toBeLessThan(1001);
  });
});
