import { describe, expect, it } from 'vitest';
import type { Action, BoardState } from './store.ts';
import { initialState, reducer } from './store.ts';
import { visibleCards, visibleLists } from './merge.ts';

function run(actions: Action[], from: BoardState = initialState()): BoardState {
  return actions.reduce(reducer, from);
}

/** Builds a board with one list and returns its id alongside the state. */
function withList(name = 'Todo'): { state: BoardState; listId: string } {
  const state = run([{ kind: 'addList', name }]);
  return { state, listId: state.board.lists[0].id };
}

describe('dirty tracking', () => {
  it('flags every created item', () => {
    const { state, listId } = withList();
    const next = reducer(state, { kind: 'addCard', listId, title: 'Buy milk' });
    const cardId = next.board.cards[0].id;
    expect(next.dirty).toContain(listId);
    expect(next.dirty).toContain(cardId);
  });

  it('flags an edited card and advances updatedAt', () => {
    const { state, listId } = withList();
    const added = reducer(state, { kind: 'addCard', listId, title: 'Buy milk' });
    const cardId = added.board.cards[0].id;
    const before = added.board.cards[0].updatedAt;
    const edited = reducer(added, {
      kind: 'updateCard',
      id: cardId,
      patch: { description: 'oat' },
    });
    expect(edited.board.cards[0].description).toBe('oat');
    expect(new Date(edited.board.cards[0].updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(before).getTime(),
    );
    expect(edited.dirty).toContain(cardId);
  });

  it('does not flag a no-op edit', () => {
    const { state, listId } = withList();
    const added = reducer(state, { kind: 'addCard', listId, title: 'Buy milk' });
    const cleared: BoardState = { ...added, dirty: [] };
    const again = reducer(cleared, { kind: 'renameList', id: listId, name: 'Todo' });
    expect(again.dirty).toEqual([]);
    expect(again).toBe(cleared);
  });

  it('ignores empty titles', () => {
    const { state, listId } = withList();
    expect(reducer(state, { kind: 'addCard', listId, title: '   ' })).toBe(state);
    expect(reducer(state, { kind: 'addList', name: '' })).toBe(state);
  });
});

describe('deleting', () => {
  it('tombstones rather than removing, so the delete can sync', () => {
    const { state, listId } = withList();
    const added = reducer(state, { kind: 'addCard', listId, title: 'Buy milk' });
    const cardId = added.board.cards[0].id;
    const deleted = reducer(added, { kind: 'deleteCard', id: cardId });
    expect(deleted.board.cards).toHaveLength(1);
    expect(deleted.board.cards[0].deletedAt).not.toBeNull();
    expect(visibleCards(deleted.board, listId)).toHaveLength(0);
  });

  it('cascades a list delete to its cards', () => {
    const { state, listId } = withList();
    const filled = run(
      [
        { kind: 'addCard', listId, title: 'one' },
        { kind: 'addCard', listId, title: 'two' },
      ],
      state,
    );
    const deleted = reducer(filled, { kind: 'deleteList', id: listId });
    expect(visibleLists(deleted.board)).toHaveLength(0);
    expect(deleted.board.cards.every((c) => c.deletedAt !== null)).toBe(true);
    // The list and both cards all need pushing.
    expect(deleted.dirty).toHaveLength(3);
  });
});

describe('toggleCard', () => {
  it('just flips done for a plain card', () => {
    const { state, listId } = withList();
    const added = reducer(state, { kind: 'addCard', listId, title: 'Buy milk' });
    const id = added.board.cards[0].id;
    const done = reducer(added, { kind: 'toggleCard', id });
    expect(done.board.cards[0].done).toBe(true);
    expect(done.board.cards[0].completions).toEqual([]);
  });

  it('records a completion for a recurring card', () => {
    const { state, listId } = withList();
    const added = reducer(state, { kind: 'addCard', listId, title: 'Water plants' });
    const id = added.board.cards[0].id;
    const recurring = reducer(added, {
      kind: 'updateCard',
      id,
      patch: { recurrence: { freq: 'daily', interval: 1 }, dueAt: new Date().toISOString() },
    });
    const done = reducer(recurring, { kind: 'toggleCard', id });
    expect(done.board.cards[0].done).toBe(true);
    expect(done.board.cards[0].completions).toHaveLength(1);
  });

  it('withdraws the completion when un-ticked, so a mis-tap cannot pad a streak', () => {
    const { state, listId } = withList();
    const added = reducer(state, { kind: 'addCard', listId, title: 'Water plants' });
    const id = added.board.cards[0].id;
    const recurring = reducer(added, {
      kind: 'updateCard',
      id,
      patch: { recurrence: { freq: 'daily', interval: 1 }, dueAt: new Date().toISOString() },
    });
    const toggled = run(
      [
        { kind: 'toggleCard', id },
        { kind: 'toggleCard', id },
      ],
      recurring,
    );
    expect(toggled.board.cards[0].done).toBe(false);
    expect(toggled.board.cards[0].completions).toHaveLength(0);
  });
});

describe('moveCard', () => {
  it('moves a card to another list and keeps it visible there', () => {
    const base = run([
      { kind: 'addList', name: 'Todo' },
      { kind: 'addList', name: 'Doing' },
    ]);
    const [todo, doing] = base.board.lists;
    const added = reducer(base, { kind: 'addCard', listId: todo.id, title: 'Buy milk' });
    const id = added.board.cards[0].id;
    const moved = reducer(added, { kind: 'moveCard', id, listId: doing.id, beforeId: null });
    expect(visibleCards(moved.board, todo.id)).toHaveLength(0);
    expect(visibleCards(moved.board, doing.id)).toHaveLength(1);
    expect(moved.dirty).toContain(id);
  });

  it('orders a card ahead of the one it was dropped on', () => {
    const { state, listId } = withList();
    const filled = run(
      [
        { kind: 'addCard', listId, title: 'first' },
        { kind: 'addCard', listId, title: 'second' },
        { kind: 'addCard', listId, title: 'third' },
      ],
      state,
    );
    const ordered = visibleCards(filled.board, listId);
    const third = ordered[2];
    const first = ordered[0];
    const moved = reducer(filled, {
      kind: 'moveCard',
      id: third.id,
      listId,
      beforeId: first.id,
    });
    expect(visibleCards(moved.board, listId).map((c) => c.title)).toEqual([
      'third',
      'first',
      'second',
    ]);
  });
});

describe('subtasks', () => {
  it('adds, ticks and removes, flagging the parent card each time', () => {
    const { state, listId } = withList();
    const added = reducer(state, { kind: 'addCard', listId, title: 'Trip' });
    const cardId = added.board.cards[0].id;
    const withSub = reducer(added, { kind: 'addSubtask', cardId, text: 'passport' });
    const subId = withSub.board.cards[0].subtasks[0].id;
    expect(withSub.dirty).toContain(cardId);

    const ticked = reducer(withSub, {
      kind: 'updateSubtask',
      cardId,
      subtaskId: subId,
      patch: { done: true },
    });
    expect(ticked.board.cards[0].subtasks[0].done).toBe(true);

    const removed = reducer(ticked, { kind: 'deleteSubtask', cardId, subtaskId: subId });
    expect(removed.board.cards[0].subtasks).toHaveLength(0);
  });
});

describe('mergeRemote', () => {
  it('clears dirty ids the server acknowledged', () => {
    const { state, listId } = withList();
    const added = reducer(state, { kind: 'addCard', listId, title: 'Buy milk' });
    const cardId = added.board.cards[0].id;
    const merged = reducer(added, {
      kind: 'mergeRemote',
      board: { lists: added.board.lists, cards: added.board.cards },
      lastSyncedAt: '2026-03-14T12:00:00.000Z',
      acknowledged: [listId, cardId],
    });
    expect(merged.dirty).toEqual([]);
    expect(merged.syncStatus).toBe('idle');
  });

  it('keeps an id dirty if it was edited again after the push', () => {
    const { state, listId } = withList();
    const added = reducer(state, { kind: 'addCard', listId, title: 'Buy milk' });
    const cardId = added.board.cards[0].id;
    // The server echoes an older copy than the one now held locally.
    const stale = added.board.cards.map((c) => ({ ...c, updatedAt: '2000-01-01T00:00:00.000Z' }));
    const merged = reducer(added, {
      kind: 'mergeRemote',
      board: { lists: added.board.lists, cards: stale },
      lastSyncedAt: '2026-03-14T12:00:00.000Z',
      acknowledged: [cardId],
    });
    expect(merged.dirty).toContain(cardId);
  });
});

describe('importBoard', () => {
  it('marks everything dirty so an import reaches the cloud', () => {
    const { state, listId } = withList();
    const added = reducer(state, { kind: 'addCard', listId, title: 'Buy milk' });
    const imported = reducer(initialState(), { kind: 'importBoard', board: added.board });
    expect(imported.dirty).toHaveLength(2);
    expect(visibleLists(imported.board)).toHaveLength(1);
  });
});
