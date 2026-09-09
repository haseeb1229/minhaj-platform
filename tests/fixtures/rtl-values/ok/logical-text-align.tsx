// FIXTURE — MUST PASS. Logical and neutral textAlign values are correct RTL,
// and rejecting them was the regression this fixture guards.
export function Logical() {
  return (
    <div style={{ textAlign: 'start' }}>
      <span style={{ textAlign: 'end' }}>end</span>
      <span style={{ textAlign: 'center' }}>center</span>
      <span style={{ textAlign: 'justify' }}>justify</span>
    </div>
  );
}
