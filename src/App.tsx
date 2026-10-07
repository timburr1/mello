import { useState } from 'react';
import { useBoard } from './hooks/useBoard.ts';
import { Board } from './components/Board.tsx';
import { CardDetail } from './components/CardDetail.tsx';
import { Settings } from './components/Settings.tsx';
import { SyncStatus } from './components/SyncStatus.tsx';

export default function App() {
  const { state } = useBoard();
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Resolved from state rather than held in state, so an edit (or a sync
  // landing underneath) is reflected in the open panel immediately.
  const openCard = openCardId
    ? (state.board.cards.find((c) => c.id === openCardId && !c.deletedAt) ?? null)
    : null;

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-3 py-2">
        <h1 className="text-lg font-semibold tracking-tight text-ink">mello</h1>
        <div className="flex items-center gap-2">
          <SyncStatus />
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
            className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-sunken hover:text-ink"
          >
            ⚙
          </button>
        </div>
      </header>

      <Board onOpenCard={setOpenCardId} />

      {openCard && <CardDetail card={openCard} onClose={() => setOpenCardId(null)} />}
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
