/**
 * Server-side validation for sync payloads.
 *
 * This deliberately re-states the shape defined in `src/lib/types.ts` rather
 * than importing it: `api/` compiles as its own package, and more importantly a
 * server must validate what a client sends it regardless of whether both sides
 * were written together. Anything unrecognised is dropped rather than stored.
 *
 * The last-write-wins comparison matches `src/lib/merge.ts`. If you change the
 * rule in one place, change it in the other.
 */

export type ItemType = 'list' | 'card';

export interface StoredItem {
  id: string;
  type: ItemType;
  userId: string;
  updatedAt: string;
  deletedAt: string | null;
  [key: string]: unknown;
}

/** Caps, so one bad client cannot write a document Cosmos will reject. */
const LIMITS = {
  title: 500,
  description: 20_000,
  name: 200,
  subtaskText: 500,
  subtasks: 200,
  completions: 365,
  itemsPerRequest: 500,
};

export const MAX_ITEMS_PER_REQUEST = LIMITS.itemsPerRequest;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function clampString(value: unknown, max: number, fallback = ''): string {
  return typeof value === 'string' ? value.slice(0, max) : fallback;
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Normalises a timestamp to exactly `Date.prototype.toISOString` form.
 *
 * The `since` filter compares `updatedAt` as a string in Cosmos SQL, which is
 * only chronologically correct while every stored value uses the same
 * fixed-width UTC format. A client sending '2026-03-14T10:00:00+01:00' would
 * otherwise sort wrongly forever.
 */
function normalizeIso(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeSubtasks(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  const out: unknown[] = [];
  for (const entry of value.slice(0, LIMITS.subtasks)) {
    const raw = asRecord(entry);
    if (!raw) continue;
    const id = clampString(raw.id, 100);
    if (!id) continue;
    out.push({
      id,
      text: clampString(raw.text, LIMITS.subtaskText),
      done: raw.done === true,
    });
  }
  return out;
}

function normalizeRecurrence(value: unknown): unknown {
  const raw = asRecord(value);
  if (!raw) return null;
  const freq = raw.freq;
  if (freq !== 'daily' && freq !== 'weekly' && freq !== 'monthly' && freq !== 'yearly') {
    return null;
  }
  const out: Record<string, unknown> = {
    freq,
    interval: Math.min(365, Math.max(1, Math.floor(finiteNumber(raw.interval, 1)))),
  };
  if (Array.isArray(raw.byWeekday)) {
    const days = raw.byWeekday
      .filter((d): d is number => typeof d === 'number' && d >= 0 && d <= 6)
      .map((d) => Math.floor(d));
    if (days.length > 0) out.byWeekday = [...new Set(days)].sort((a, b) => a - b);
  }
  if (typeof raw.byMonthDay === 'number' && raw.byMonthDay >= 1 && raw.byMonthDay <= 31) {
    out.byMonthDay = Math.floor(raw.byMonthDay);
  }
  if (typeof raw.byMonth === 'number' && raw.byMonth >= 0 && raw.byMonth <= 11) {
    out.byMonth = Math.floor(raw.byMonth);
  }
  return out;
}

function normalizeCompletions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeIso)
    .filter((c): c is string => c !== null)
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .slice(0, LIMITS.completions);
}

/**
 * Turns one untrusted entry into something storable, or null to drop it.
 * `userId` always comes from the authenticated principal, never the body.
 */
export function normalizeItem(value: unknown, userId: string): StoredItem | null {
  const raw = asRecord(value);
  if (!raw) return null;

  const id = clampString(raw.id, 100);
  if (!id) return null;

  const updatedAt = normalizeIso(raw.updatedAt);
  if (!updatedAt) return null;

  const deletedAt = normalizeIso(raw.deletedAt);

  if (raw.type === 'list') {
    return {
      id,
      type: 'list',
      userId,
      name: clampString(raw.name, LIMITS.name, 'Untitled'),
      position: finiteNumber(raw.position),
      updatedAt,
      deletedAt,
    };
  }

  if (raw.type === 'card') {
    const listId = clampString(raw.listId, 100);
    if (!listId) return null;
    return {
      id,
      type: 'card',
      userId,
      listId,
      position: finiteNumber(raw.position),
      title: clampString(raw.title, LIMITS.title),
      description: clampString(raw.description, LIMITS.description),
      subtasks: normalizeSubtasks(raw.subtasks),
      done: raw.done === true,
      recurrence: normalizeRecurrence(raw.recurrence),
      dueAt: normalizeIso(raw.dueAt),
      completions: normalizeCompletions(raw.completions),
      updatedAt,
      deletedAt,
    };
  }

  return null;
}

/** True when `incoming` should replace `existing`. Ties keep the stored copy. */
export function isNewer(incoming: StoredItem, existing: StoredItem | undefined): boolean {
  if (!existing) return true;
  const a = new Date(incoming.updatedAt).getTime();
  const b = new Date(existing.updatedAt).getTime();
  if (Number.isNaN(a)) return false;
  if (Number.isNaN(b)) return true;
  return a > b;
}

export interface ClientPrincipal {
  userId: string;
  userDetails: string;
  identityProvider: string;
  userRoles: string[];
}

/**
 * Reads the identity Static Web Apps injects. The header is set by the platform
 * after it has validated the session; it is not something a browser can forge
 * through the Static Web Apps front door.
 */
export function readPrincipal(header: string | null | undefined): ClientPrincipal | null {
  if (!header) return null;
  try {
    const decoded = Buffer.from(header, 'base64').toString('utf8');
    const parsed = asRecord(JSON.parse(decoded));
    if (!parsed) return null;
    const userId = typeof parsed.userId === 'string' ? parsed.userId : '';
    if (!userId) return null;
    return {
      userId,
      userDetails: typeof parsed.userDetails === 'string' ? parsed.userDetails : '',
      identityProvider:
        typeof parsed.identityProvider === 'string' ? parsed.identityProvider : '',
      userRoles: Array.isArray(parsed.userRoles)
        ? parsed.userRoles.filter((r): r is string => typeof r === 'string')
        : [],
    };
  } catch {
    return null;
  }
}
