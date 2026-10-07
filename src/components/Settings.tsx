import { useRef, useState } from 'react';
import { exportBoard, parseImport } from '../lib/storage.ts';
import { useBoard } from '../hooks/useBoard.ts';
import { Modal } from './Modal.tsx';
import { relativeTime } from '../lib/time.ts';

export function Settings({ onClose }: { onClose: () => void }) {
  const { state, dispatch, principal, syncNow } = useBoard();
  const fileInput = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const download = () => {
    const now = new Date();
    const blob = new Blob([exportBoard(state.board, now)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `mello-${now.toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const onFile = async (file: File) => {
    setNotice(null);
    setProblem(null);
    const text = await file.text();
    const result = parseImport(text);
    if ('error' in result) {
      setProblem(result.error);
      return;
    }
    const counts = `${result.board.lists.length} lists, ${result.board.cards.length} cards`;
    dispatch({ kind: 'importBoard', board: result.board });
    setNotice(`Imported ${counts}. Syncing…`);
    syncNow();
  };

  const cardCount = state.board.cards.filter((c) => !c.deletedAt).length;
  const listCount = state.board.lists.filter((l) => !l.deletedAt).length;

  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="space-y-6">
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Account</h3>
          {principal ? (
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 text-sm text-ink">
                Signed in as <span className="font-medium">{principal.userDetails || 'you'}</span>
                <span className="block text-xs text-muted">
                  via {principal.identityProvider || 'unknown provider'}
                </span>
              </p>
              <a
                href="/logout"
                className="shrink-0 rounded-md border border-line px-3 py-1.5 text-sm text-ink hover:bg-sunken"
              >
                Sign out
              </a>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted">
                Not signed in. The board works offline either way; signing in is what lets it sync
                between your phone and desktop.
              </p>
              <a
                href="/login"
                className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:opacity-90"
              >
                Sign in
              </a>
            </div>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Sync</h3>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Last synced</dt>
              <dd className="text-ink">
                {state.lastSyncedAt
                  ? relativeTime(new Date(state.lastSyncedAt), new Date())
                  : 'never'}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Waiting to sync</dt>
              <dd className="text-ink">{state.dirty.length}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted">On this board</dt>
              <dd className="text-ink">
                {listCount} lists, {cardCount} cards
              </dd>
            </div>
          </dl>
          {state.syncError && <p className="mt-2 text-xs text-overdue">{state.syncError}</p>}
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
            Backup
          </h3>
          <p className="mb-2 text-sm text-muted">
            A plain JSON file of everything, including completion history. Useful as a backup and as
            a way off this app entirely.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={download}
              className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-sunken"
            >
              Export JSON
            </button>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-sunken"
            >
              Import JSON
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void onFile(file);
              }}
            />
          </div>
          <p className="mt-2 text-xs text-overdue">
            Importing replaces the board on this device.
          </p>
          {notice && <p className="mt-2 text-xs text-done">{notice}</p>}
          {problem && <p className="mt-2 text-xs text-overdue">{problem}</p>}
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">About</h3>
          <p className="text-sm text-muted">
            mello keeps your board in this browser and syncs it to your own Azure account. No
            analytics, no third-party scripts, nothing phoning home.
          </p>
        </section>
      </div>
    </Modal>
  );
}
