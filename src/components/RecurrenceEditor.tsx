import type { Card, Recurrence, RecurrenceFreq } from '../lib/types.ts';
import { WEEKDAY_LABELS } from '../lib/types.ts';
import { describeRecurrence } from '../lib/recurrence.ts';
import { pinRecurrenceToDate } from '../lib/store.ts';
import { useBoard } from '../hooks/useBoard.ts';

const FREQS: { value: RecurrenceFreq | 'none'; label: string }[] = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

export function RecurrenceEditor({ card }: { card: Card }) {
  const { dispatch } = useBoard();
  const rec = card.recurrence;

  const setRecurrence = (next: Recurrence | null) => {
    dispatch({ kind: 'updateCard', id: card.id, patch: { recurrence: next } });
  };

  const onFreqChange = (value: string) => {
    if (value === 'none') {
      setRecurrence(null);
      return;
    }
    const freq = value as RecurrenceFreq;
    // A recurring card needs an anchor date. Default to its due date, or today.
    const anchor = card.dueAt ? new Date(card.dueAt) : new Date();
    const base: Recurrence = { freq, interval: rec?.interval ?? 1 };
    setRecurrence(pinRecurrenceToDate(base, anchor));
    if (!card.dueAt) {
      const midnight = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
      dispatch({ kind: 'updateCard', id: card.id, patch: { dueAt: midnight.toISOString() } });
    }
  };

  const toggleWeekday = (day: number) => {
    if (!rec) return;
    const current = rec.byWeekday ?? [];
    const next = current.includes(day)
      ? current.filter((d) => d !== day)
      : [...current, day].sort((a, b) => a - b);
    setRecurrence({ ...rec, byWeekday: next.length > 0 ? next : undefined });
  };

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Repeats</h3>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={rec?.freq ?? 'none'}
          onChange={(event) => onFreqChange(event.target.value)}
          aria-label="Repeat frequency"
          className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
        >
          {FREQS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>

        {rec && !(rec.freq === 'weekly' && (rec.byWeekday?.length ?? 0) > 0) && (
          <label className="flex items-center gap-1.5 text-sm text-muted">
            every
            <input
              type="number"
              min={1}
              max={365}
              value={rec.interval}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10);
                setRecurrence({
                  ...rec,
                  interval: Number.isNaN(parsed) ? 1 : Math.min(365, Math.max(1, parsed)),
                });
              }}
              aria-label="Repeat interval"
              className="w-16 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
            />
          </label>
        )}
      </div>

      {rec?.freq === 'weekly' && (
        <div className="mt-2">
          <div className="flex flex-wrap gap-1">
            {WEEKDAY_LABELS.map((label, day) => {
              const selected = (rec.byWeekday ?? []).includes(day);
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => toggleWeekday(day)}
                  aria-pressed={selected}
                  className={
                    'h-8 w-10 rounded-md border text-xs font-medium ' +
                    (selected
                      ? 'border-accent bg-accent text-accent-ink'
                      : 'border-line text-muted hover:bg-sunken')
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-[11px] text-muted">
            Picking specific days ignores the interval above.
          </p>
        </div>
      )}

      {rec && (
        <p className="mt-2 text-xs text-muted">
          {describeRecurrence(rec)}. Ticking it off records the date and it comes back next time
          round.
        </p>
      )}
    </section>
  );
}
