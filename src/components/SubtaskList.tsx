import { useState } from 'react';
import type { Card } from '../lib/types.ts';
import { useBoard } from '../hooks/useBoard.ts';

export function SubtaskList({ card }: { card: Card }) {
  const { dispatch } = useBoard();
  const [draft, setDraft] = useState('');
  const done = card.subtasks.filter((s) => s.done).length;

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    dispatch({ kind: 'addSubtask', cardId: card.id, text });
    setDraft('');
  };

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Subtasks</h3>
        {card.subtasks.length > 0 && (
          <span className="text-xs text-muted">
            {done}/{card.subtasks.length}
          </span>
        )}
      </div>

      <ul className="space-y-1">
        {card.subtasks.map((subtask) => (
          <li key={subtask.id} className="group flex items-center gap-2">
            <input
              id={`subtask-${subtask.id}`}
              type="checkbox"
              checked={subtask.done}
              onChange={(event) =>
                dispatch({
                  kind: 'updateSubtask',
                  cardId: card.id,
                  subtaskId: subtask.id,
                  patch: { done: event.target.checked },
                })
              }
              className="h-4 w-4 shrink-0 accent-[var(--color-accent)]"
            />
            <label
              htmlFor={`subtask-${subtask.id}`}
              className={
                'min-w-0 flex-1 break-words text-sm ' +
                (subtask.done ? 'text-muted line-through' : 'text-ink')
              }
            >
              {subtask.text}
            </label>
            <button
              type="button"
              onClick={() =>
                dispatch({ kind: 'deleteSubtask', cardId: card.id, subtaskId: subtask.id })
              }
              aria-label={`Delete subtask ${subtask.text}`}
              className="shrink-0 rounded px-2 py-1 text-xs text-muted hover:bg-sunken hover:text-overdue"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
        className="mt-2 flex gap-2"
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Add a subtask"
          aria-label="New subtask"
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-sunken disabled:opacity-40"
        >
          Add
        </button>
      </form>
    </section>
  );
}
