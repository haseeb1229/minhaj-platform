// FIXTURE — MUST FAIL.
// A stylesheet and component in a workspace that did not exist when the
// checkers were written. Discovery must notice it automatically; a hard-coded
// root list would let this escape RTL validation entirely.
export function Button() {
  return <button className="ml-2 pr-4">physical</button>;
}
