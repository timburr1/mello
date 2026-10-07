import { useState } from 'react';
import type { Card } from '../lib/types.ts';
import type { CardPatch } from '../lib/store.ts';
import { dateKeyToIso, isoToDateKey, localDateKey, streakFor } from '../lib/recurrence.ts';
import { useBoard } from '../hooks/useBoard.ts';
import { Modal } from './Modal.tsx';
import { RecurrenceEditor } from './RecurrenceEditor.tsx';
import { SubtaskList } from './SubtaskList.tsx';

export function CardDetail({ card, onClose }: { card: Card; onClose: () => void }) {
  const { dispatch } = useBoard();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const streak = streakFor(card);

  const patch = (next: CardPatch) => {
    dispatch({ kind: 'updateCard', id: card.id, patch: next });
  };

  return (
    <Modal
      title={card.title || 'Card'}
      onClose={onClose}
      footer={
        confirmingDelete ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-ink">Delete this card?</span>
            <span className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="rounded-md border border-line px-3 py-1.5 text-sm text-ink hover:bg-sunken"
              >
                Keep
              </button>
              <button
                type="button"
                onClick={() => {
                  dispatch({ kind: 'deleteCard', id: card.id });
                  onClose();
                }}
                className="rounded-md bg-overdue px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
              >
                Delete
              </button>
            </span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="rounded-md px-2 py-1.5 text-sm text-muted hover:bg-sunken hover:text-overdue"
          >
            Delete card
          </button>
        )
      }
    >
      <div className="space-y-5">
        <div>
          <label htmlFor="card-title" className="mb-1 block text-xs font-semibold tracking-wide text-muted uppercase">
            Title
          </label>
          <input
            id="card-title"
            value={card.title}
            onChange={(event) => patch({ title: event.target.value })}
            className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="card-description" className="mb-1 block text-xs font-semibold tracking-wide text-muted uppercase">
            Description
          </label>
          <textarea
            id="card-description"
            value={card.description}
            onChange={(event) => patch({ description: event.target.value })}
            rows={4}
            placeholder="Notes, links, context…"
            className="w-full resize-y rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="card-due" className="mb-1 block text-xs font-semibold tracking-wide text-muted uppercase">
            {card.recurrence ? 'Next due' : 'Due date'}
          </label>
          <div className="flex gap-2">
            <input
              id="card-due"
              type="date"
              value={isoToDateKey(card.dueAt)}
              onChange={(event) => patch({ dueAt: dateKeyToIso(event.target.value) })}
              className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
            />
            {card.dueAt && (
              <button
                type="button"
                onClick={() => patch({ dueAt: null })}
                className="rounded-md px-2 py-1.5 text-sm text-muted hover:bg-sunken"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <RecurrenceEditor card={card} />

        <SubtaskList card={card} />

        {card.completions.length > 0 && (
          <section>
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">History</h3>
              {streak > 0 && <span className="text-xs text-streak">{streak}× streak</span>}
            </div>
            <ol className="space-y-0.5 text-xs text-muted">
              {card.completions.slice(0, 10).map((stamp) => (
                <li key={stamp}>{localDateKey(new Date(stamp))}</li>
              ))}
            </ol>
            {card.completions.length > 10 && (
              <p className="mt-1 text-xs text-muted">
                and {card.completions.length - 10} more
              </p>
            )}
          </section>
        )}
      </div>
    </Modal>
  );
}
