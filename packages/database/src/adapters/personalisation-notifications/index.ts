/**
 * Personalisation & Notifications' persistence adapter — semantically owned by
 * that context (ARCHITECTURE.md §3.1.1) and physically here. It reads and
 * writes only its own tables: no content, Identity or email table is touched,
 * and no Prisma capability leaves it.
 */
export { PersonalDataError } from './shared.ts';
export { createPersonalSaved } from './saved.ts';
export { createPersonalHistory } from './history.ts';
export { createPersonalSettings } from './settings.ts';
export { createPersonalNotifications } from './notifications.ts';
export { createPersonalExport } from './export.ts';
export { createPersonalDisposition, createPersonalPurge } from './disposition.ts';
export { createPersonalHoldings } from './holdings.ts';
export { createNewsletter } from './newsletter.ts';
