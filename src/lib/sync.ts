import type { Item } from './types.ts';
import { coerceItem } from './storage.ts';
import { boardFromItems } from './merge.ts';
import type { Board } from './types.ts';

/**
 * Talks to `/api/sync`. No React in here so it can be reasoned about (and
 * tested) on its own.
 *
 * Responses are run back through `coerceItem`: the API is ours, but a response
 * reaching the reducer unvalidated would turn any server-side regression into a
 * white screen on a board the user cannot then repair.
 */

export const SYNC_ENDPOINT = '/api/sync';
export const AUTH_ME_ENDPOINT = '/.auth/me';

/** Thrown on a 401, meaning the Static Web Apps session has lapsed. */
export class AuthRequiredError extends Error {
  constructor() {
    super('Sign in to sync.');
    this.name = 'AuthRequiredError';
  }
}

export interface PullResult {
  board: Board;
  serverTime: string | null;
}

export interface PushResult {
  /** Ids the server stored, echoed back so the client can clear them. */
  acknowledged: string[];
  board: Board;
  serverTime: string | null;
}

export interface ClientPrincipal {
  userId: string;
  userDetails: string;
  identityProvider: string;
}

function parseItems(value: unknown): Item[] {
  if (!Array.isArray(value)) return [];
  return value.map(coerceItem).filter((i): i is Item => i !== null);
}

function serverTimeOf(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const time = (value as Record<string, unknown>).serverTime;
  if (typeof time !== 'string') return null;
  return Number.isNaN(new Date(time).getTime()) ? null : time;
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('The sync service returned a malformed response.');
  }
}

async function guard(res: Response): Promise<unknown> {
  if (res.status === 401 || res.status === 403) throw new AuthRequiredError();
  if (!res.ok) {
    throw new Error('Sync failed (' + res.status + ').');
  }
  return readJson(res);
}

/** Items changed on the server since `since` (everything when null). */
export async function pull(since: string | null, signal?: AbortSignal): Promise<PullResult> {
  const url = since ? SYNC_ENDPOINT + '?since=' + encodeURIComponent(since) : SYNC_ENDPOINT;
  const res = await fetch(url, {
    method: 'GET',
    headers: { accept: 'application/json' },
    // Never serve a sync response from cache: a stale body would reintroduce
    // cards that have since been deleted.
    cache: 'no-store',
    signal,
  });
  const body = await guard(res);
  const items = parseItems((body as Record<string, unknown>).items);
  return { board: boardFromItems(items), serverTime: serverTimeOf(body) };
}

/** Pushes local edits, then returns whatever the server considers current. */
export async function push(
  items: Item[],
  since: string | null,
  signal?: AbortSignal,
): Promise<PushResult> {
  const res = await fetch(SYNC_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ items, since }),
    cache: 'no-store',
    signal,
  });
  const body = await guard(res);
  const raw = body as Record<string, unknown>;
  const acknowledged = Array.isArray(raw.acknowledged)
    ? raw.acknowledged.filter((id): id is string => typeof id === 'string')
    : items.map((i) => i.id);
  return {
    acknowledged,
    board: boardFromItems(parseItems(raw.items)),
    serverTime: serverTimeOf(body),
  };
}

/**
 * Who Static Web Apps thinks we are, or null when signed out. This endpoint is
 * served by the platform and is anonymous, so it never 401s.
 */
export async function whoAmI(signal?: AbortSignal): Promise<ClientPrincipal | null> {
  try {
    const res = await fetch(AUTH_ME_ENDPOINT, { headers: { accept: 'application/json' }, signal });
    if (!res.ok) return null;
    const body = (await readJson(res)) as Record<string, unknown>;
    const principal = body.clientPrincipal;
    if (typeof principal !== 'object' || principal === null) return null;
    const p = principal as Record<string, unknown>;
    return {
      userId: typeof p.userId === 'string' ? p.userId : '',
      userDetails: typeof p.userDetails === 'string' ? p.userDetails : '',
      identityProvider: typeof p.identityProvider === 'string' ? p.identityProvider : '',
    };
  } catch {
    // Offline, or running `vite dev` with no Static Web Apps emulator in front.
    return null;
  }
}

export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}
