// FIXTURE — MUST FAIL. `contexts/invented` is not one of the 16 contexts.
export function invented(): string {
  return 'not an approved bounded context';
}
