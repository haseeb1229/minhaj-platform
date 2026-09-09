export interface MessageStore {
  save(body: string): Promise<string>;
}
