/**
 * `crypto.randomUUID` needs a secure context. Served over HTTPS (and on
 * localhost) that always holds, but a LAN IP during `vite --host` testing on a
 * phone does not, so fall back rather than crash while adding a card.
 */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
