import { useBoard } from '../hooks/useBoard.ts';
import { relativeTime } from '../lib/time.ts';

/**
 * A quiet status line, not a blocking indicator. The board works offline, so a
 * failed sync is information rather than an error the user must act on.
 */
export function SyncStatus() {
  const { state, principal, syncNow } = useBoard();
  const pending = state.dirty.length;

  const label = (() => {
    if (state.syncStatus === 'syncing') return 'Syncing…';
    if (state.syncStatus === 'offline') {
      return pending > 0 ? `Offline · ${pending} to sync` : 'Offline';
    }
    if (state.syncStatus === 'error') return state.syncError ?? 'Sync failed';
    if (pending > 0) return `${pending} to sync`;
    if (!state.lastSyncedAt) return 'Not synced yet';
    return 'Synced ' + relativeTime(new Date(state.lastSyncedAt), new Date());
  })();

  const tone =
    state.syncStatus === 'error'
      ? 'text-overdue'
      : state.syncStatus === 'offline'
        ? 'text-streak'
        : 'text-muted';

  const needsSignIn = state.syncStatus === 'error' && !principal;

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={tone} aria-live="polite">
        {label}
      </span>
      {needsSignIn ? (
        <a
          href="/login"
          className="rounded-md bg-accent px-2 py-1 font-medium text-accent-ink hover:opacity-90"
        >
          Sign in
        </a>
      ) : (
        <button
          type="button"
          onClick={syncNow}
          disabled={state.syncStatus === 'syncing'}
          className="rounded-md px-2 py-1 font-medium text-accent hover:bg-sunken disabled:opacity-50"
        >
          Sync
        </button>
      )}
    </div>
  );
}
