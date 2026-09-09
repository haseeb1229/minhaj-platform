import type { MessageStore } from '@fixture/raw-capability-web/contexts/messaging';
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
