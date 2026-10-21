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
  | { kind: 'ensureLists' }
  | { kind: 'addList'; name: string }
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

/**
 * The board's fixed columns. The ids are deterministic so that every device
 * that seeds them produces the same records, and sync merges them instead of
 * duplicating them.
 */
export const FIXED_LISTS = [
  { id: 'list-todo', name: 'TODO' },
  { id: 'list-today', name: 'Today' },
  { id: 'list-doing', name: 'Doing' },
  { id: 'list-done', name: 'Done' },
] as const;

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

function listNamed(board: Board, names: string[]): BoardList | null {
  return visibleLists(board).find((l) => names.includes(l.name.trim().toLowerCase())) ?? null;
}

/** The list completed cards live in, found by name so it survives a re-sync. */
export function findDoneList(board: Board): BoardList | null {
  return listNamed(board, ['done']);
}

/**
 * Where an un-done card goes back to: a list called Todo, or failing that the
 * first list that is not Done.
 */
export function findTodoList(board: Board): BoardList | null {
  const named = listNamed(board, ['todo', 'to do', 'to-do']);
  if (named) return named;
  const done = findDoneList(board);
  return visibleLists(board).find((l) => l.id !== done?.id) ?? null;
}

/**
 * Sets `done`, recording or withdrawing a completion for recurring cards.
 * Un-ticking withdraws the completion it recorded, otherwise a mis-tap would
 * inflate the streak permanently.
 */
function withDone(card: Card, done: boolean, now: string): Card {
  if (card.done === done) return card;
  if (!done) {
    const completions = card.recurrence ? card.completions.slice(1) : card.completions;
    return { ...card, done: false, completions };
  }
  if (card.recurrence) return addCompletion(card, new Date(now));
  return { ...card, done: true };
}

/** Top of Done (newest first), bottom of anything else. */
function placementIn(board: Board, cardId: string, list: BoardList, done: BoardList | null): number {
  const ordered = visibleCards(board, list.id).filter((c) => c.id !== cardId);
  const beforeId = list.id === done?.id ? (ordered[0]?.id ?? null) : null;
  return positionForDrop(ordered, beforeId);
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

    case 'ensureLists': {
      // Idempotent: creates any missing fixed list, then folds every other
      // list (a random-id one from an older version, or one that arrived by
      // sync) into the fixed list of the same name, or TODO if none matches.
      const now = stamp();
      const fixedIds = new Set<string>(FIXED_LISTS.map((f) => f.id));
      const touched: string[] = [];
      let lists = state.board.lists;
      let cards = state.board.cards;

      FIXED_LISTS.forEach((fixed, index) => {
        const existing = lists.find((l) => l.id === fixed.id);
        if (existing && !existing.deletedAt) return;
        const list: BoardList = {
          id: fixed.id,
          type: 'list',
          userId: existing?.userId ?? '',
          name: fixed.name,
          position: index + 1,
          updatedAt: now,
          deletedAt: null,
        };
        lists = existing ? lists.map((l) => (l.id === fixed.id ? list : l)) : [...lists, list];
        touched.push(list.id);
      });

      const strays = lists.filter((l) => !fixedIds.has(l.id) && !l.deletedAt);
      for (const stray of strays) {
        const target =
          FIXED_LISTS.find((f) => f.name.toLowerCase() === stray.name.trim().toLowerCase()) ??
          FIXED_LISTS[0];
        cards = cards.map((c) => {
          if (c.listId !== stray.id) return c;
          touched.push(c.id);
          return { ...c, listId: target.id, updatedAt: now };
        });
        lists = lists.map((l) => (l.id === stray.id ? { ...l, deletedAt: now, updatedAt: now } : l));
        touched.push(stray.id);
      }

      if (touched.length === 0) return state;
      return {
        ...state,
        board: { lists, cards },
        dirty: withDirty(state.dirty, touched),
      };
    }

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

    case 'toggleCard': {
      // Ticking files the card into Done; un-ticking a card in Done sends it
      // back to Todo, so finished work never lingers in the working lists.
      const doneList = findDoneList(state.board);
      const todoList = findTodoList(state.board);
      return patchCard(state, action.id, (card, now) => {
        const next = withDone(card, !card.done, now);
        const dest = next.done ? doneList : card.listId === doneList?.id ? todoList : null;
        if (!dest || dest.id === card.listId) return next;
        const position = placementIn(state.board, card.id, dest, doneList);
        return { ...next, listId: dest.id, position };
      });
    }

    case 'moveCard': {
      const target = visibleCards(state.board, action.listId).filter((c) => c.id !== action.id);
      const position = positionForDrop(target, action.beforeId);
      const doneList = findDoneList(state.board);
      return patchCard(state, action.id, (card, now) => {
        if (card.listId === action.listId && card.position === position) return card;
        const moved = { ...card, listId: action.listId, position };
        // Dragging across the Done boundary is the same as ticking or
        // un-ticking, so a card's checkbox always agrees with its column.
        if (!doneList || card.listId === action.listId) return moved;
        return withDone(moved, action.listId === doneList.id, now);
      });
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
      const { cards: rolled, changed } = rollBoardForward(state.board.cards, new Date());
      if (changed.length === 0) return state;
      // A recurring card sitting in Done comes back to Todo when its next
      // period starts. Appended one after another so several returning at
      // once keep distinct positions.
      const doneList = findDoneList(state.board);
      const todoList = findTodoList(state.board);
      let cards = rolled;
      if (doneList && todoList) {
        const returning = new Set(changed);
        let tail = endPosition(visibleCards(state.board, todoList.id).map((c) => c.position));
        cards = rolled.map((card) => {
          if (!returning.has(card.id) || card.listId !== doneList.id) return card;
          const position = tail;
          tail = positionBetween(tail, null);
          return { ...card, listId: todoList.id, position };
        });
      }
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
