import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

/**
 * Dialog shell for the card detail and settings panes.
 *
 * On a phone it fills the screen; on a desktop it is a centred panel. Escape
 * and a backdrop tap both close, because reaching a small × in the corner one
 * handed is miserable.
 */
export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // Stop the board scrolling behind the open panel.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="flex max-h-full w-full flex-col overflow-hidden bg-raised shadow-xl outline-none sm:max-w-lg sm:rounded-xl"
      >
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="truncate text-base font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-xl leading-none text-muted hover:bg-sunken hover:text-ink"
          >
            &times;
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer ? (
          <footer className="shrink-0 border-t border-line px-4 py-3">{footer}</footer>
        ) : null}
      </div>
    </div>
  );
}
