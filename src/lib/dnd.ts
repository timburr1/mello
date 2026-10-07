import type { Board } from './types.ts';
import { visibleCards, visibleLists } from './merge.ts';

/**
 * Turns a dnd-kit drop into the `beforeId` the reducer wants.
 *
 * `index` is the sortable index dnd-kit reports for whatever is being hovered,
 * or null when the drop landed on a column's empty space. Using dnd-kit's own
 * index keeps the committed order identical to the preview the user was looking
 * at while dragging; computing it independently drifts by one as soon as you
 * drag downwards.
 */
export interface DropTarget {
  listId: string;
  beforeId: string | null;
}

export function cardDropTarget(
  board: Board,
  activeId: string,
  listId: string,
  index: number | null,
): DropTarget {
  const rest = visibleCards(board, listId).filter((c) => c.id !== activeId);
  const slot = index === null ? rest.length : Math.max(0, Math.min(index, rest.length));
  return { listId, beforeId: rest[slot]?.id ?? null };
}

export function listDropBeforeId(
  board: Board,
  activeId: string,
  index: number | null,
): string | null {
  const rest = visibleLists(board).filter((l) => l.id !== activeId);
  const slot = index === null ? rest.length : Math.max(0, Math.min(index, rest.length));
  return rest[slot]?.id ?? null;
}
