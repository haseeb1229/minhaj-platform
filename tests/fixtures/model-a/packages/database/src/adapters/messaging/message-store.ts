// Adapter INTERNALS. This is where raw database capability legitimately lives
// — an adapter that could not touch Prisma would not be an adapter.
import type { MessageStore } from '@fixture/model-a-web/contexts/messaging';
import { getDatabaseClient } from '../../client';

export function createMessageStore(): MessageStore {
  const database = getDatabaseClient();

  return {
    save: async (body: string): Promise<string> => {
      void database;
      return body;
    },
  };
}
