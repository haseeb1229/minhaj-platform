// FIXTURE — MUST FAIL. Physical textAlign values break RTL.
export function Physical() {
  return (
    <div style={{ textAlign: 'left' }}>
      <span style={{ textAlign: 'right' }}>right</span>
    </div>
  );
}
