import { CosmosClient } from '@azure/cosmos';
import type { Container } from '@azure/cosmos';

/**
 * Cosmos accessor for the sync function.
 *
 * Throughput is provisioned on the *database* at 400 RU/s shared, deliberately
 * inside the free tier's 1000 RU/s. Giving the container its own dedicated
 * throughput is what turns a free-tier account into a billed one, so the
 * container is created without any.
 */

const DATABASE_ID = process.env.COSMOS_DATABASE ?? 'mello';
const CONTAINER_ID = process.env.COSMOS_CONTAINER ?? 'items';
const DATABASE_THROUGHPUT = 400;

let containerPromise: Promise<Container> | null = null;

export function getContainer(): Promise<Container> {
  if (!containerPromise) {
    // A failed init must not be cached, or one transient error at cold start
    // would poison every later request to this worker.
    containerPromise = init().catch((error: unknown) => {
      containerPromise = null;
      throw error;
    });
  }
  return containerPromise;
}

async function init(): Promise<Container> {
  const connectionString = process.env.COSMOS_CONNECTION_STRING;
  if (!connectionString) {
    throw new Error('COSMOS_CONNECTION_STRING is not configured.');
  }

  const client = new CosmosClient(connectionString);
  const { database } = await client.databases.createIfNotExists({
    id: DATABASE_ID,
    throughput: DATABASE_THROUGHPUT,
  });
  const { container } = await database.containers.createIfNotExists({
    id: CONTAINER_ID,
    partitionKey: { paths: ['/userId'] },
  });
  return container;
}

/** Cosmos system fields, which the client has no use for. */
const SYSTEM_FIELDS = new Set(['_rid', '_self', '_etag', '_attachments', '_ts']);

export function stripSystemFields(doc: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(doc)) {
    if (!SYSTEM_FIELDS.has(key)) out[key] = value;
  }
  return out;
}
