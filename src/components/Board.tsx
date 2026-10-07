import { useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { visibleLists } from '../lib/merge.ts';
import { cardDropTarget, listDropBeforeId } from '../lib/dnd.ts';
import { useBoard } from '../hooks/useBoard.ts';
import { List } from './List.tsx';

export function Board({ onOpenCard }: { onOpenCard: (id: string) => void }) {
  const { state, dispatch } = useBoard();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [addingList, setAddingList] = useState(false);
  const [listName, setListName] = useState('');

  const lists = visibleLists(state.board);

  const sensors = useSensors(
    // A 6px threshold is what separates a tap (open the card) from a drag.
    // Without it, every tap on a card body would begin a drag and the card
    // would never open on a touch screen.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const activeCard = state.board.cards.find((c) => c.id === activeId) ?? null;

  const onDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;

    const activeData = active.data.current;
    const overData = over.data.current;
    const id = String(active.id);

    if (activeData?.type === 'list') {
      if (overData?.type !== 'list') return;
      const index: number | null = overData.sortable?.index ?? null;
      dispatch({ kind: 'moveList', id, beforeId: listDropBeforeId(state.board, id, index) });
      return;
    }

    if (activeData?.type !== 'card') return;

    let listId: string | null = null;
    let index: number | null = null;
    if (overData?.type === 'card') {
      listId = String(overData.listId);
      index = overData.sortable?.index ?? null;
    } else if (overData?.type === 'listDrop') {
      // Dropped on a column's empty space: append.
      listId = String(overData.listId);
    }
    if (!listId) return;

    const target = cardDropTarget(state.board, id, listId, index);
    dispatch({ kind: 'moveCard', id, listId: target.listId, beforeId: target.beforeId });
  };

  const addList = () => {
    const name = listName.trim();
    if (!name) return;
    dispatch({ kind: 'addList', name });
    setListName('');
    setAddingList(false);
  };

  if (lists.length === 0) {
    return (
      <div className="grid flex-1 place-items-center p-6">
        <div className="max-w-sm text-center">
          <h2 className="text-lg font-semibold text-ink">An empty board</h2>
          <p className="mt-1 text-sm text-muted">
            Start with three columns, or add your own.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => {
                for (const name of ['Todo', 'Doing', 'Done']) {
                  dispatch({ kind: 'addList', name });
                }
              }}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90"
            >
              Todo / Doing / Done
            </button>
            <button
              type="button"
              onClick={() => setAddingList(true)}
              className="rounded-md border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-sunken"
            >
              Add a list
            </button>
          </div>
          {addingList && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                addList();
              }}
              className="mt-3 flex gap-2"
            >
              <input
                autoFocus
                value={listName}
                onChange={(event) => setListName(event.target.value)}
                placeholder="List name"
                aria-label="List name"
                className="min-w-0 flex-1 rounded-md border border-line bg-raised px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
              />
              <button
                type="submit"
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink"
              >
                Add
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex h-full snap-x snap-mandatory items-start gap-3 p-3 sm:snap-none">
          <SortableContext items={lists.map((l) => l.id)} strategy={horizontalListSortingStrategy}>
            {lists.map((list) => (
              <List key={list.id} list={list} onOpenCard={onOpenCard} />
            ))}
          </SortableContext>

          <div className="w-[85vw] shrink-0 snap-start sm:w-64">
            {addingList ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  addList();
                }}
                className="rounded-xl bg-sunken p-2"
              >
                <input
                  autoFocus
                  value={listName}
                  onChange={(event) => setListName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      setListName('');
                      setAddingList(false);
                    }
                  }}
                  placeholder="List name"
                  aria-label="List name"
                  className="w-full rounded-md border border-line bg-raised px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
                />
                <div className="mt-1 flex gap-2">
                  <button
                    type="submit"
                    disabled={!listName.trim()}
                    className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-40"
                  >
                    Add list
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setListName('');
                      setAddingList(false);
                    }}
                    className="rounded-md px-2 py-1.5 text-sm text-muted hover:bg-surface"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setAddingList(true)}
                className="w-full rounded-xl bg-sunken/60 px-3 py-3 text-left text-sm text-muted hover:bg-sunken hover:text-ink"
              >
                + Add another list
              </button>
            )}
          </div>
        </div>
      </div>

      {/* A lightweight preview; the real card stays dimmed in place. */}
      <DragOverlay dropAnimation={null}>
        {activeCard ? (
          <div className="rounded-lg border border-accent bg-raised p-2 text-sm text-ink shadow-lg">
            {activeCard.title}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
