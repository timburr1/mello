import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { BoardList } from '../lib/types.ts';
import { visibleCards } from '../lib/merge.ts';
import { useBoard } from '../hooks/useBoard.ts';
import { CardTile } from './CardTile.tsx';

export function List({ list, onOpenCard }: { list: BoardList; onOpenCard: (id: string) => void }) {
  const { state, dispatch } = useBoard();
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(list.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const cards = visibleCards(state.board, list.id);
  const remaining = cards.filter((c) => !c.done).length;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: list.id,
    data: { type: 'list' },
  });

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

  const commitRename = () => {
    setRenaming(false);
    const trimmed = name.trim();
    if (!trimmed || trimmed === list.name) {
      setName(list.name);
      return;
    }
    dispatch({ kind: 'renameList', id: list.id, name: trimmed });
  };

  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={
        'flex max-h-full w-[85vw] shrink-0 snap-start flex-col rounded-xl bg-sunken sm:w-72 ' +
        (isDragging ? 'opacity-50' : '')
      }
    >
      <header className="flex items-start gap-1 px-3 pt-3 pb-2">
        {renaming ? (
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitRename();
              if (event.key === 'Escape') {
                setName(list.name);
                setRenaming(false);
              }
            }}
            aria-label="List name"
            className="min-w-0 flex-1 rounded-md border border-accent bg-raised px-2 py-1 text-sm font-semibold text-ink focus:outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => setRenaming(true)}
            {...attributes}
            {...listeners}
            className="min-w-0 flex-1 cursor-grab touch-manipulation rounded-md px-1 py-1 text-left active:cursor-grabbing"
          >
            <span className="block truncate text-sm font-semibold text-ink">{list.name}</span>
            <span className="text-[11px] text-muted">
              {remaining === 0 ? 'all clear' : `${remaining} to do`}
            </span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setConfirmingDelete((v) => !v)}
          aria-label={`List options for ${list.name}`}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted hover:bg-surface hover:text-ink"
        >
          ⋯
        </button>
      </header>

      {confirmingDelete && (
        <div className="mx-3 mb-2 rounded-lg border border-line bg-raised p-2 text-xs">
          <p className="mb-2 text-ink">
            Delete “{list.name}” and its {cards.length} {cards.length === 1 ? 'card' : 'cards'}?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="flex-1 rounded-md border border-line px-2 py-1 text-ink hover:bg-sunken"
            >
              Keep
            </button>
            <button
              type="button"
              onClick={() => {
                dispatch({ kind: 'deleteList', id: list.id });
                setConfirmingDelete(false);
              }}
              className="flex-1 rounded-md bg-overdue px-2 py-1 font-medium text-white hover:opacity-90"
            >
              Delete
            </button>
          </div>
        </div>
      )}

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
