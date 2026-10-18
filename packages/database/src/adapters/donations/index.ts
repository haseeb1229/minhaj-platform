/**
 * Donations' persistence adapter — semantically owned by that context
 * (ARCHITECTURE.md §3.1.1) and physically here. It reads and writes only
 * Donations' own tables; User is reached only as the typed foreign keys its
 * rows hold (and by the migration's own triggers), and no Identity,
 * Membership or other context's table is read by the adapter. No Prisma
 * capability leaves it: the surface is the ports' factories and the one
 * refusal type. The payment provider is a separate adapter.
 */
export { DonationsDataError } from './errors.ts';
export { createDonationActivationReader } from './activation.ts';
export { createDonationCampaigns, createDonationCatalogueReader } from './catalogue.ts';
export { createDonationCommunication } from './communication.ts';
export { createDonationDisposition } from './disposition.ts';
export { createDonationDonor } from './donor.ts';
export { createDonationLedger } from './ledger.ts';
export { createDonationOwner } from './owner.ts';
export { createDonationRefunds } from './refunds.ts';
export { createDonationStaff } from './staff.ts';
