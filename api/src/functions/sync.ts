import { app } from '@azure/functions';
import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getContainer, stripSystemFields } from '../cosmos';
import type { StoredItem } from '../model';
import { MAX_ITEMS_PER_REQUEST, isNewer, normalizeItem, readPrincipal } from '../model';

/**
 * GET  /api/sync?since=<iso>   items changed since `since` (all when omitted)
 * POST /api/sync               { items, since } -> upsert, then the same read
 *
 * Writes apply last-write-wins on `updatedAt`, so a stale push cannot clobber a
 * newer edit made on the other device. The response always carries the server's
 * current view, which is how the pushing client learns it lost a race.
 *
 * `authLevel` is anonymous because authorisation happens a layer up:
 * staticwebapp.config.json restricts /api/* to the `authenticated` role, and
 * the identity arrives as the x-ms-client-principal header. Every row is scoped
 * to that principal's userId, which is also the Cosmos partition key.
 */

/**
 * Rewinding the watermark a few seconds covers clock skew between the function
 * host and Cosmos. Re-sending an item the client already has is free - the
 * merge is idempotent - whereas missing one strands an edit indefinitely.
 */
const WATERMARK_SKEW_MS = 5000;

interface SyncResponse {
  items: Record<string, unknown>[];
  serverTime: string;
  acknowledged?: string[];
}

function json(status: number, body: unknown): HttpResponseInit {
  return {
    status,
    jsonBody: body,
    headers: {
      'content-type': 'application/json',
      // A cached sync response would hand back cards that have since been
      // deleted, so no layer may store it.
      'cache-control': 'no-store',
    },
  };
}

/** Everything for this user changed strictly after `since`. */
async function readSince(userId: string, since: string | null): Promise<StoredItem[]> {
  const container = await getContainer();
  const query = since
    ? {
        query: 'SELECT * FROM c WHERE c.userId = @userId AND c.updatedAt > @since',
        parameters: [
          { name: '@userId', value: userId },
          { name: '@since', value: since },
        ],
      }
    : {
        query: 'SELECT * FROM c WHERE c.userId = @userId',
        parameters: [{ name: '@userId', value: userId }],
      };

  const { resources } = await container.items
    .query<StoredItem>(query, { partitionKey: userId })
    .fetchAll();
  return resources;
}

async function fetchExisting(userId: string, ids: string[]): Promise<Map<string, StoredItem>> {
  const found = new Map<string, StoredItem>();
  if (ids.length === 0) return found;

  const container = await getContainer();
  // Chunked so the generated IN clause stays a sane size.
  const CHUNK = 100;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const parameters = chunk.map((id, index) => ({ name: '@id' + index, value: id }));
    const placeholders = parameters.map((p) => p.name).join(', ');
    const { resources } = await container.items
      .query<StoredItem>(
        {
          query:
            'SELECT * FROM c WHERE c.userId = @userId AND c.id IN (' + placeholders + ')',
          parameters: [{ name: '@userId', value: userId }, ...parameters],
        },
        { partitionKey: userId },
      )
      .fetchAll();
    for (const item of resources) found.set(item.id, item);
  }
  return found;
}

export async function syncHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const principal = readPrincipal(request.headers.get('x-ms-client-principal'));
  if (!principal) {
    return json(401, { error: 'Sign in to sync.' });
  }
  const userId = principal.userId;

  // Captured before any work so a write landing mid-request is still newer than
  // the watermark the client stores, and therefore still arrives next time.
  const serverTime = new Date(Date.now() - WATERMARK_SKEW_MS).toISOString();

  try {
    if (request.method === 'GET') {
      const since = request.query.get('since');
      const items = await readSince(userId, since);
      const body: SyncResponse = {
        items: items.map(stripSystemFields),
        serverTime,
      };
      return json(200, body);
    }

    const raw: unknown = await request.json().catch(() => null);
    const payload =
      typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    const incomingRaw = Array.isArray(payload.items) ? payload.items : [];
    if (incomingRaw.length > MAX_ITEMS_PER_REQUEST) {
      return json(413, {
        error: 'Too many items in one request; sync in smaller batches.',
      });
    }

    const incoming: StoredItem[] = [];
    for (const entry of incomingRaw) {
      const item = normalizeItem(entry, userId);
      if (item) incoming.push(item);
    }

    const existing = await fetchExisting(
      userId,
      incoming.map((i) => i.id),
    );

    const container = await getContainer();
    const written: string[] = [];
    for (const item of incoming) {
      if (!isNewer(item, existing.get(item.id))) continue;
      await container.items.upsert(item);
      written.push(item.id);
    }

    // Every item we understood is acknowledged, including ones the server kept
    // its own newer copy of: the client clears those from its dirty set because
    // this response hands it the winning version to merge.
    const acknowledged = incoming.map((i) => i.id);

    const since = typeof payload.since === 'string' ? payload.since : null;
    const items = await readSince(userId, since);

    context.log(
      `sync: user=${userId} received=${incomingRaw.length} stored=${written.length} returned=${items.length}`,
    );

    const body: SyncResponse = {
      items: items.map(stripSystemFields),
      serverTime,
      acknowledged,
    };
    return json(200, body);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    context.error('sync failed: ' + message);
    // The client keeps working from localStorage and retries, so a 500 here is
    // a delay rather than data loss.
    return json(500, { error: 'Sync failed. Your changes are still saved locally.' });
  }
}

app.http('sync', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'sync',
  handler: syncHandler,
});
