/**
 * Membership's persistence adapter — semantically owned by that context
 * (ARCHITECTURE.md §3.1.1) and physically here. It reads and writes only
 * Membership's own tables; User is reached only as the typed foreign keys its
 * rows hold, and no Identity, Donations or other context's table is read. No
 * Prisma capability leaves it: the surface is the ports' factories and the one
 * refusal type.
 */
export { MembershipDataError } from './errors.ts';
export {
  createMembershipCatalogue,
  createMembershipCatalogueReader,
} from './catalogue.ts';
export { createMembershipApplicant } from './applicant.ts';
export { createMembershipStaff } from './staff.ts';
export { createMembershipCommunication } from './communication.ts';
export { createMembershipDisposition, createMembershipExport } from './account.ts';
