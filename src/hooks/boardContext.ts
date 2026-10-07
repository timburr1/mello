import { createContext } from 'react';
import type { Dispatch } from 'react';
import type { Action, BoardState } from '../lib/store.ts';
import type { ClientPrincipal } from '../lib/sync.ts';

export interface BoardContextValue {
  state: BoardState;
  dispatch: Dispatch<Action>;
  /** Who Static Web Apps says we are, or null when signed out. */
  principal: ClientPrincipal | null;
  /** Force a sync now, rather than waiting for the debounce. */
  syncNow: () => void;
}

export const BoardContext = createContext<BoardContextValue | null>(null);
