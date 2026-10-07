import type { Board, BoardList, Card, Recurrence, Subtask } from './types.ts';
import { addCompletion, rollBoardForward } from './recurrence.ts';
import { mergeBoards, positionBetween, visibleCards, visibleLists } from './merge.ts';
import { newId } from './id.ts';
import { coerceBoard } from './storage.ts';

/**
 * The board reducer.
 *
 * Every mutation routes through `patchCard` / `patchList`, which stamp
 * `updatedAt` and add the id to `dirty` as one step. That is the whole reason
 * this file is shaped the way it is: sync correctness depends on those two
 * things happening together on every single write, and leaving it to each
 * action to remember would guarantee that one eventually did not.
 *
 * `userId` is left blank on creation. The API fills it from the authenticated
 * principal, so the client never asserts whose data it is.
 */

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';

export interface BoardState {
  /** False until localStorage has been read. Guards the persist effect from
   *  writing an empty board over stored data on the first render. */
  hydrated: boolean;
  board: Board;
  /** Ids edited locally and not yet acknowledged by the server. */
  dirty: string[];
  lastSyncedAt: string | null;
  syncStatus: SyncStatus;
  syncError: string | null;
}

export type Action =
  | { kind: 'hydrate'; board: Board; dirty: string[]; lastSyncedAt: string | null }
  | { kind: 'addList'; name: string }
  | { kind: 'renameList'; id: string; name: string }
  | { kind: 'deleteList'; id: string }
  | { kind: 'moveList'; id: string; beforeId: string | null }
  | { kind: 'addCard'; listId: string; title: string }
  | { kind: 'updateCard'; id: string; patch: CardPatch }
  | { kind: 'deleteCard'; id: string }
  | { kind: 'toggleCard'; id: string }
  | { kind: 'moveCard'; id: string; listId: string; beforeId: string | null }
  | { kind: 'addSubtask'; cardId: string; text: string }
  | { kind: 'updateSubtask'; cardId: string; subtaskId: string; patch: Partial<Subtask> }
  | { kind: 'deleteSubtask'; cardId: string; subtaskId: string }
  | { kind: 'rollForward' }
  | { kind: 'mergeRemote'; board: Board; lastSyncedAt: string | null; acknowledged: string[] }
  | { kind: 'setSyncStatus'; status: SyncStatus; error?: string | null }
  | { kind: 'importBoard'; board: Board };

export type CardPatch = Partial<
  Pick<Card, 'title' | 'description' | 'dueAt' | 'recurrence' | 'done'>
>;

export function initialState(): BoardState {
  return {
    hydrated: false,
    board: { lists: [], cards: [] },
    dirty: [],
    lastSyncedAt: null,
    syncStatus: 'idle',
    syncError: null,
  };
}

function stamp(): string {
  return new Date().toISOString();
}

/**
 * Returns the *same array reference* when nothing new became dirty. The push
 * debounce and the persist effect both key off this array, so churning its
 * identity on every keystroke would restart the timer and rewrite localStorage
 * for no reason.
 */
function withDirty(dirty: string[], ids: string[]): string[] {
  if (ids.length === 0) return dirty;
  const next = new Set(dirty);
  let changed = false;
  for (const id of ids) {
    if (!next.has(id)) {
      next.add(id);
      changed = true;
    }
  }
  return changed ? [...next] : dirty;
}

/** Applies `fn` to one card, stamping and flagging it. */
function patchCard(state: BoardState, id: string, fn: (card: Card, now: string) => Card): BoardState {
  const now = stamp();
  let touched = false;
  const cards = state.board.cards.map((card) => {
    if (card.id !== id) return card;
    const next = fn(card, now);
    if (next === card) return card;
    touched = true;
    return { ...next, updatedAt: now };
  });
  if (!touched) return state;
  return {
    ...state,
    board: { ...state.board, cards },
    dirty: withDirty(state.dirty, [id]),
  };
}

function patchList(
  state: BoardState,
  id: string,
  fn: (list: BoardList, now: string) => BoardList,
): BoardState {
  const now = stamp();
  let touched = false;
  const lists = state.board.lists.map((list) => {
    if (list.id !== id) return list;
    const next = fn(list, now);
    if (next === list) return list;
    touched = true;
    return { ...next, updatedAt: now };
  });
  if (!touched) return state;
  return {
    ...state,
    board: { ...state.board, lists },
    dirty: withDirty(state.dirty, [id]),
  };
}

function endPosition(positions: number[]): number {
  if (positions.length === 0) return positionBetween(null, null);
  return positionBetween(Math.max(...positions), null);
}

/**
 * Resolves a drop target into a numeric position: the slot before `beforeId`,
 * or the end of the list when it is null.
 */
function positionForDrop(ordered: { id: string; position: number }[], beforeId: string | null): number {
  if (beforeId === null) return endPosition(ordered.map((o) => o.position));
  const index = ordered.findIndex((o) => o.id === beforeId);
  if (index === -1) return endPosition(ordered.map((o) => o.position));
  const after = ordered[index].position;
  const before = index === 0 ? null : ordered[index - 1].position;
  return positionBetween(before, after);
}

export function reducer(state: BoardState, action: Action): BoardState {
  switch (action.kind) {
    case 'hydrate':
      return {
        ...state,
        hydrated: true,
        board: action.board,
        dirty: action.dirty,
        lastSyncedAt: action.lastSyncedAt,
      };

    case 'addList': {
      const name = action.name.trim();
      if (!name) return state;
      const now = stamp();
      const list: BoardList = {
        id: newId(),
        type: 'list',
        userId: '',
        name,
        position: endPosition(visibleLists(state.board).map((l) => l.position)),
        updatedAt: now,
        deletedAt: null,
      };
      return {
        ...state,
        board: { ...state.board, lists: [...state.board.lists, list] },
        dirty: withDirty(state.dirty, [list.id]),
      };
    }

    case 'renameList': {
      const name = action.name.trim();
      if (!name) return state;
      return patchList(state, action.id, (list) => (list.name === name ? list : { ...list, name }));
    }

    case 'deleteList': {
      // Tombstone the list and everything on it, in one stamped batch, so the
      // delete competes as a single write on the sync timeline.
      const now = stamp();
      const doomed = state.board.cards.filter((c) => c.listId === action.id && !c.deletedAt);
      const lists = state.board.lists.map((l) =>
        l.id === action.id ? { ...l, deletedAt: now, updatedAt: now } : l,
      );
      const cards = state.board.cards.map((c) =>
        c.listId === action.id && !c.deletedAt ? { ...c, deletedAt: now, updatedAt: now } : c,
      );
      return {
        ...state,
        board: { lists, cards },
        dirty: withDirty(state.dirty, [action.id, ...doomed.map((c) => c.id)]),
      };
    }

    case 'moveList': {
      const ordered = visibleLists(state.board).filter((l) => l.id !== action.id);
      const position = positionForDrop(ordered, action.beforeId);
      return patchList(state, action.id, (list) =>
        list.position === position ? list : { ...list, position },
      );
    }

    case 'addCard': {
      const title = action.title.trim();
      if (!title) return state;
      const now = stamp();
      const card: Card = {
        id: newId(),
        type: 'card',
        userId: '',
        listId: action.listId,
        position: endPosition(visibleCards(state.board, action.listId).map((c) => c.position)),
        title,
        description: '',
        subtasks: [],
        done: false,
        recurrence: null,
        dueAt: null,
        completions: [],
        updatedAt: now,
        deletedAt: null,
      };
      return {
        ...state,
        board: { ...state.board, cards: [...state.board.cards, card] },
        dirty: withDirty(state.dirty, [card.id]),
      };
    }

    case 'updateCard':
      return patchCard(state, action.id, (card) => {
        const next = { ...card, ...action.patch };
        // Re-pin the month day when the due date moves, so a monthly card set
        // to the 31st keeps that intent through February.
        if (action.patch.dueAt !== undefined && next.recurrence && next.dueAt) {
          const due = new Date(next.dueAt);
          if (!Number.isNaN(due.getTime())) {
            next.recurrence = pinRecurrenceToDate(next.recurrence, due);
          }
        }
        return next;
      });

    case 'deleteCard':
      return patchCard(state, action.id, (card, now) =>
        card.deletedAt ? card : { ...card, deletedAt: now },
      );

    case 'toggleCard':
      return patchCard(state, action.id, (card, now) => {
        if (card.done) {
          // Un-ticking a recurring card withdraws the completion it recorded,
          // otherwise a mis-tap would inflate the streak permanently.
          const completions = card.recurrence ? card.completions.slice(1) : card.completions;
          return { ...card, done: false, completions };
        }
        if (card.recurrence) return addCompletion(card, new Date(now));
        return { ...card, done: true };
      });

    case 'moveCard': {
      const target = visibleCards(state.board, action.listId).filter((c) => c.id !== action.id);
      const position = positionForDrop(target, action.beforeId);
      return patchCard(state, action.id, (card) =>
        card.listId === action.listId && card.position === position
          ? card
          : { ...card, listId: action.listId, position },
      );
    }

    case 'addSubtask': {
      const text = action.text.trim();
      if (!text) return state;
      return patchCard(state, action.cardId, (card) => ({
        ...card,
        subtasks: [...card.subtasks, { id: newId(), text, done: false }],
      }));
    }

    case 'updateSubtask':
      return patchCard(state, action.cardId, (card) => ({
        ...card,
        subtasks: card.subtasks.map((s) =>
          s.id === action.subtaskId ? { ...s, ...action.patch } : s,
        ),
      }));

    case 'deleteSubtask':
      return patchCard(state, action.cardId, (card) => ({
        ...card,
        subtasks: card.subtasks.filter((s) => s.id !== action.subtaskId),
      }));

    case 'rollForward': {
      const { cards, changed } = rollBoardForward(state.board.cards, new Date());
      if (changed.length === 0) return state;
      return {
        ...state,
        board: { ...state.board, cards },
        dirty: withDirty(state.dirty, changed),
      };
    }

    case 'mergeRemote': {
      const merged = mergeBoards(state.board, action.board);
      // Only clear ids the server accepted *and* that have not been edited
      // again since the push went out.
      const acknowledged = new Set(action.acknowledged);
      const stillDirty = state.dirty.filter((id) => {
        if (!acknowledged.has(id)) return true;
        const local = findItemUpdatedAt(state.board, id);
        const remote = findItemUpdatedAt(action.board, id);
        if (local === null || remote === null) return true;
        return new Date(local).getTime() > new Date(remote).getTime();
      });
      return {
        ...state,
        board: merged,
        dirty: stillDirty,
        lastSyncedAt: action.lastSyncedAt ?? state.lastSyncedAt,
        syncStatus: 'idle',
        syncError: null,
      };
    }

    case 'setSyncStatus':
      return {
        ...state,
        syncStatus: action.status,
        syncError: action.error ?? null,
      };

    case 'importBoard': {
      const board = coerceBoard(action.board);
      // An import is wholly local until it syncs, so everything is dirty.
      const ids = [...board.lists.map((l) => l.id), ...board.cards.map((c) => c.id)];
      return { ...state, board, dirty: ids };
    }
  }
}

function findItemUpdatedAt(board: Board, id: string): string | null {
  const list = board.lists.find((l) => l.id === id);
  if (list) return list.updatedAt;
  const card = board.cards.find((c) => c.id === id);
  return card ? card.updatedAt : null;
}

/** Keeps `byMonthDay` / `byMonth` aligned with the card's due date. */
export function pinRecurrenceToDate(rec: Recurrence, due: Date): Recurrence {
  if (rec.freq === 'monthly') return { ...rec, byMonthDay: due.getDate() };
  if (rec.freq === 'yearly') {
    return { ...rec, byMonth: due.getMonth(), byMonthDay: due.getDate() };
  }
  return rec;
}
