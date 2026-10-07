import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Card } from '../lib/types.ts';
import { describeRecurrence, isDueToday, isOverdue, localDateKey, streakFor } from '../lib/recurrence.ts';
import { useBoard } from '../hooks/useBoard.ts';

export function CardTile({ card, onOpen }: { card: Card; onOpen: (id: string) => void }) {
  const { dispatch } = useBoard();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: 'card', listId: card.listId },
  });

  const now = new Date();
  const overdue = isOverdue(card, now);
  const dueToday = isDueToday(card, now);
  const streak = streakFor(card);
  const doneSubtasks = card.subtasks.filter((s) => s.done).length;

  return (
    <li
      ref={setNodeRef}
      data-dnd-draggable
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={
        'rounded-lg border border-line bg-raised shadow-sm ' +
        (isDragging ? 'opacity-40' : 'opacity-100')
      }
    >
      <div className="flex items-stretch gap-1 p-2">
        <button
          type="button"
          onClick={() => dispatch({ kind: 'toggleCard', id: card.id })}
          aria-pressed={card.done}
          aria-label={card.done ? `Mark ${card.title} not done` : `Mark ${card.title} done`}
          className="mt-px grid h-7 w-7 shrink-0 place-items-center rounded-md hover:bg-sunken"
        >
          <span
            aria-hidden="true"
            className={
              'grid h-[18px] w-[18px] place-items-center rounded border text-[11px] leading-none ' +
              (card.done
                ? 'border-done bg-done text-white'
                : 'border-line text-transparent')
            }
          >
            ✓
          </span>
        </button>

        {/*
          The drag handle is the card body rather than a separate grip: on a
          phone a dedicated handle is a tiny target, and dnd-kit distinguishes a
          tap from a drag by distance, so opening the card still works.
        */}
        <button
          type="button"
          onClick={() => onOpen(card.id)}
          {...attributes}
          {...listeners}
          // min-h-7 + stretch so the tap target covers the whole card row.
          // Sized to the text alone it was 20px tall, which is a miss on a phone.
          className="flex min-h-7 min-w-0 flex-1 cursor-grab touch-manipulation flex-col justify-center text-left active:cursor-grabbing"
        >
          <span
            className={
              'block break-words text-sm ' +
              (card.done ? 'text-muted line-through' : 'text-ink')
            }
          >
            {card.title}
          </span>

          {(card.recurrence || card.dueAt || card.subtasks.length > 0 || card.description) && (
            <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
              {card.dueAt && (
                <span className={overdue ? 'font-medium text-overdue' : dueToday ? 'font-medium text-accent' : ''}>
                  {overdue ? 'Overdue' : dueToday ? 'Today' : localDateKey(new Date(card.dueAt))}
                </span>
              )}
              {card.recurrence && <span>↻ {describeRecurrence(card.recurrence)}</span>}
              {streak > 1 && <span className="text-streak">{streak}× streak</span>}
              {card.subtasks.length > 0 && (
                <span>
                  {doneSubtasks}/{card.subtasks.length}
                </span>
              )}
              {card.description && <span aria-label="Has a description">≡</span>}
            </span>
          )}
        </button>
      </div>
    </li>
  );
}
