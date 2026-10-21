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
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { visibleLists } from '../lib/merge.ts';
import { cardDropTarget } from '../lib/dnd.ts';
import { useBoard } from '../hooks/useBoard.ts';
import { List } from './List.tsx';

export function Board({ onOpenCard }: { onOpenCard: (id: string) => void }) {
  const { state, dispatch } = useBoard();
  const [activeId, setActiveId] = useState<string | null>(null);

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
          {lists.map((list) => (
            <List key={list.id} list={list} onOpenCard={onOpenCard} />
          ))}
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
