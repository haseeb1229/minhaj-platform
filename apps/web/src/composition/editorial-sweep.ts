import 'server-only';
import { editorialRuntime } from './editorial';
import { appLogger } from './logging';

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
export function startEditorialSweep(): void {
  if (timer !== null) return;
  // Single web instance. SQL expected versions prevent duplicate publication;
  // multi-instance scheduling remains gated on a reviewed leasing design.
  timer = setInterval(() => {
    if (running) return;
    running = true;
    void (async () => {
      try {
        await editorialRuntime().editorial.runDue();
        await editorialRuntime().correspondence.purgeExpired();
      } catch {
        appLogger().error(
          { operation: 'editorial-sweep' },
          'Editorial sweep failed; durable work remains visible.',
        );
      } finally {
        running = false;
      }
    })();
  }, 30_000);
  timer.unref();
  process.once('SIGTERM', stopEditorialSweep);
  process.once('SIGINT', stopEditorialSweep);
}
function stopEditorialSweep(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
  process.removeListener('SIGTERM', stopEditorialSweep);
  process.removeListener('SIGINT', stopEditorialSweep);
}
