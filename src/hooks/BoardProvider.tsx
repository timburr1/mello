import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { initialState, reducer } from '../lib/store.ts';
import { loadBoard, loadSyncMeta, pruneTombstones, saveBoard, saveSyncMeta } from '../lib/storage.ts';
import { collectDirty } from '../lib/merge.ts';
import { localDateKey } from '../lib/recurrence.ts';
import { AuthRequiredError, isOffline, pull, push, whoAmI } from '../lib/sync.ts';
import type { ClientPrincipal } from '../lib/sync.ts';
import { BoardContext } from './boardContext.ts';
import type { BoardContextValue } from './boardContext.ts';

/** How long to wait after the last edit before pushing. */
const PUSH_DEBOUNCE_MS = 2000;
/** How often to check whether the local date has rolled over. */
const DATE_CHECK_MS = 60_000;

export function BoardProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [principal, setPrincipal] = useState<ClientPrincipal | null>(null);

  // Sync reads the newest state rather than whatever a stale closure captured,
  // which matters because a push can be triggered from a timer. Updated in an
  // effect rather than during render: this effect is declared before the ones
  // that schedule a sync, so it has always run by the time a timer fires.
  const stateRef = useRef(state);
  const inFlight = useRef(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Read localStorage once, then immediately roll any recurring cards into the
  // current period so the board is correct before the first paint the user sees.
  useEffect(() => {
    const board = pruneTombstones(loadBoard(), new Date());
    const meta = loadSyncMeta();
    dispatch({
      kind: 'hydrate',
      board,
      dirty: meta.dirty,
      lastSyncedAt: meta.lastSyncedAt,
    });
    dispatch({ kind: 'rollForward' });
  }, []);

  // Persist on every change. Gated on `hydrated` so the first render, which
  // still holds an empty board, cannot overwrite what is on disk.
  useEffect(() => {
    if (!state.hydrated) return;
    saveBoard(state.board);
    saveSyncMeta({ lastSyncedAt: state.lastSyncedAt, dirty: state.dirty });
  }, [state.hydrated, state.board, state.dirty, state.lastSyncedAt]);

  useEffect(() => {
    const controller = new AbortController();
    void whoAmI(controller.signal).then(setPrincipal);
    return () => controller.abort();
  }, []);

  const syncNow = useCallback(() => {
    const current = stateRef.current;
    if (!current.hydrated || inFlight.current) return;
    if (isOffline()) {
      dispatch({ kind: 'setSyncStatus', status: 'offline' });
      return;
    }

    inFlight.current = true;
    dispatch({ kind: 'setSyncStatus', status: 'syncing' });

    const dirtyItems = collectDirty(current.board, current.dirty);
    const request =
      dirtyItems.length > 0
        ? push(dirtyItems, current.lastSyncedAt).then((r) => ({
            board: r.board,
            serverTime: r.serverTime,
            acknowledged: r.acknowledged,
          }))
        : pull(current.lastSyncedAt).then((r) => ({
            board: r.board,
            serverTime: r.serverTime,
            acknowledged: [] as string[],
          }));

    void request
      .then((result) => {
        dispatch({
          kind: 'mergeRemote',
          board: result.board,
          lastSyncedAt: result.serverTime,
          acknowledged: result.acknowledged,
        });
      })
      .catch((error: unknown) => {
        if (error instanceof AuthRequiredError) {
          setPrincipal(null);
          dispatch({ kind: 'setSyncStatus', status: 'error', error: 'Sign in to sync.' });
          return;
        }
        // An offline board is a working board, so a failed sync is a status
        // line, never an interruption.
        const message = error instanceof Error ? error.message : 'Sync failed.';
        dispatch({
          kind: 'setSyncStatus',
          status: isOffline() ? 'offline' : 'error',
          error: message,
        });
      })
      .finally(() => {
        inFlight.current = false;
      });
  }, []);

  // Push on a debounce after edits settle, so dragging a card across four
  // positions is one request rather than four.
  useEffect(() => {
    if (!state.hydrated || state.dirty.length === 0) return;
    const timer = setTimeout(syncNow, PUSH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [state.hydrated, state.dirty, syncNow]);

  // Pull once on open.
  useEffect(() => {
    if (!state.hydrated) return;
    syncNow();
    // Deliberately keyed on hydration alone: this is the open-the-app pull.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.hydrated]);

  // Coming back to the tab, or back online, is the other moment worth syncing
  // and worth re-checking the date.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      dispatch({ kind: 'rollForward' });
      syncNow();
    };
    const onOnline = () => syncNow();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [syncNow]);

  // A tab left open past midnight must still reset its daily cards, and
  // `visibilitychange` never fires for it.
  useEffect(() => {
    let lastKey = localDateKey(new Date());
    const timer = setInterval(() => {
      const key = localDateKey(new Date());
      if (key === lastKey) return;
      lastKey = key;
      dispatch({ kind: 'rollForward' });
    }, DATE_CHECK_MS);
    return () => clearInterval(timer);
  }, []);

  const value = useMemo<BoardContextValue>(
    () => ({ state, dispatch, principal, syncNow }),
    [state, principal, syncNow],
  );

  return <BoardContext.Provider value={value}>{children}</BoardContext.Provider>;
}
