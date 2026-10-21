import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { BoardList } from '../lib/types.ts';
import { visibleCards } from '../lib/merge.ts';
import { useBoard } from '../hooks/useBoard.ts';
import { CardTile } from './CardTile.tsx';

export function List({ list, onOpenCard }: { list: BoardList; onOpenCard: (id: string) => void }) {
  const { state, dispatch } = useBoard();
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');

  const cards = visibleCards(state.board, list.id);
  const remaining = cards.filter((c) => !c.done).length;

  // A separate droppable covering the column lets a card be dropped into an
  // empty list, where there is no card to hover over.
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `list-drop-${list.id}`,
    data: { type: 'listDrop', listId: list.id },
  });

  const addCard = () => {
    const title = draft.trim();
    if (!title) return;
    dispatch({ kind: 'addCard', listId: list.id, title });
    setDraft('');
    // Stay open: adding several cards in a row is the common case.
  };

  return (
    <section
      className="flex max-h-full w-[85vw] shrink-0 snap-start flex-col rounded-xl bg-sunken sm:w-72"
    >
      <header className="px-3 pt-3 pb-2">
        <span className="block truncate text-sm font-semibold text-ink">{list.name}</span>
        <span className="text-[11px] text-muted">
          {remaining === 0 ? 'all clear' : `${remaining} to do`}
        </span>
      </header>

      <div
        ref={setDropRef}
        className={
          'min-h-[3rem] flex-1 overflow-y-auto px-2 pb-2 ' + (isOver ? 'bg-surface/40' : '')
        }
      >
        <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-2">
            {cards.map((card) => (
              <CardTile key={card.id} card={card} onOpen={onOpenCard} />
            ))}
          </ul>
        </SortableContext>

        {cards.length === 0 && !composing && (
          <p className="px-1 py-2 text-xs text-muted">Nothing here yet.</p>
        )}
      </div>

      <div className="px-2 pb-2">
        {composing ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              addCard();
            }}
          >
            <textarea
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  addCard();
                }
                if (event.key === 'Escape') {
                  setDraft('');
                  setComposing(false);
                }
              }}
              rows={2}
              placeholder="What needs doing?"
              aria-label={`New card in ${list.name}`}
              className="w-full resize-none rounded-lg border border-line bg-raised px-2 py-1.5 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
            />
            <div className="mt-1 flex gap-2">
              <button
                type="submit"
                disabled={!draft.trim()}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-40"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft('');
                  setComposing(false);
                }}
                className="rounded-md px-2 py-1.5 text-sm text-muted hover:bg-surface"
              >
                Done
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="w-full rounded-md px-2 py-2 text-left text-sm text-muted hover:bg-surface hover:text-ink"
          >
            + Add a card
          </button>
        )}
      </div>
    </section>
  );
}
