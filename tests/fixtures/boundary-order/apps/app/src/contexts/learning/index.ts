// The Learning context's PUBLIC interface. Messaging is allowlisted to reach
// exactly this (DOMAIN_MODEL.md §3.1, §3.2).
export function isCurrentlyEnrolled(_user: string, _course: string): boolean {
  return false;
}
