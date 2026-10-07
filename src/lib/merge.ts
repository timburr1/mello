import type { Board, BoardList, Card, Item } from './types.ts';

/**
 * Last-write-wins merging, used when a sync pull comes back.
 *
 * One user on two devices does not need vector clocks or CRDTs; it needs
 * edits not to vanish and deletes not to come back. Both fall out of two rules:
 *
 *   1. Every mutation stamps `updatedAt`, and the newer stamp wins.
 *   2. Deleting sets `deletedAt` *and* `updatedAt`, so a delete is just another
 *      write and competes on the same timeline as an edit. Without the
 *      tombstone, deleting a card on the phone then syncing the desktop would
 *      hand the card straight back.
 *
 * An exact tie keeps the local copy. Ties only happen at millisecond
 * resolution, and in that case the unsynced local edit is the one at risk.
 *
 * The API applies the same `updatedAt` comparison server-side. That rule is
 * deliberately duplicated rather than shared, because `api/` builds as its own
 * package; if you change the comparison here, change `api/src/functions/sync.ts`
 * to match.
 */

function pickNewer<T extends Item>(local: T, remote: T): T {
  const localTime = new Date(local.updatedAt).getTime();
  const remoteTime = new Date(remote.updatedAt).getTime();
  // A corrupt stamp loses to a valid one rather than poisoning the merge.
  if (Number.isNaN(remoteTime)) return local;
  if (Number.isNaN(localTime)) return remote;
  return remoteTime > localTime ? remote : local;
}

function mergeCollection<T extends Item>(local: T[], remote: T[]): T[] {
  const byId = new Map<string, T>();
  for (const item of local) byId.set(item.id, item);
  for (const item of remote) {
    const existing = byId.get(item.id);
    byId.set(item.id, existing ? pickNewer(existing, item) : item);
  }
  return [...byId.values()];
}

export function mergeBoards(local: Board, remote: Board): Board {
  return {
    lists: mergeCollection<BoardList>(local.lists, remote.lists),
    cards: mergeCollection<Card>(local.cards, remote.cards),
  };
}

/** The items the server has not yet acknowledged. */
export function collectDirty(board: Board, dirty: Iterable<string>): Item[] {
  const wanted = new Set(dirty);
  if (wanted.size === 0) return [];
  const out: Item[] = [];
  for (const list of board.lists) if (wanted.has(list.id)) out.push(list);
  for (const card of board.cards) if (wanted.has(card.id)) out.push(card);
  return out;
}

/** Folds a flat item array from the API back into board shape. */
export function boardFromItems(items: Item[]): Board {
  const lists: BoardList[] = [];
  const cards: Card[] = [];
  for (const item of items) {
    if (item.type === 'list') lists.push(item);
    else cards.push(item);
  }
  return { lists, cards };
}

/** Visible lists, in display order. */
export function visibleLists(board: Board): BoardList[] {
  return board.lists.filter((l) => !l.deletedAt).sort((a, b) => a.position - b.position);
}

/** Visible cards for one list, in display order. */
export function visibleCards(board: Board, listId: string): Card[] {
  return board.cards
    .filter((c) => !c.deletedAt && c.listId === listId)
    .sort((a, b) => a.position - b.position);
}

/**
 * Positions are spaced so a single reorder rewrites one card instead of
 * renumbering the list, which keeps the dirty set (and the sync payload) small.
 */
export const POSITION_GAP = 1000;

export function positionBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return POSITION_GAP;
  if (before === null) return (after as number) - POSITION_GAP;
  if (after === null) return before + POSITION_GAP;
  return (before + after) / 2;
}
