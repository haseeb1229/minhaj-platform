// FIXTURE — MUST FAIL. Review bypass: physical inline style properties, which
// avoid className entirely.
export function ViaInlineStyle() {
  return (
    <div style={{ marginLeft: 8, paddingRight: 4 }}>
      <span style={{ left: 0, textAlign: 'left' }}>physical style keys</span>
    </div>
  );
}
