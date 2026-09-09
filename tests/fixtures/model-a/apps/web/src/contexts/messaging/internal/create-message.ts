import type { MessageStore } from './message-store-port';

export interface MessagingService {
  send(body: string): Promise<string>;
}

// The context service. It PERSISTS internally, through its own port, and hands
// back domain values — never the means of persistence (ARCHITECTURE.md §3.1.1).
export function createMessagingService(store: MessageStore): MessagingService {
  return {
    send: (body: string): Promise<string> => store.save(body),
  };
}
