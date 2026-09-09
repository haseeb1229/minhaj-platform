// FIXTURE — EXPECTED TO FAIL.
// Physical-direction Tailwind utilities silently break Urdu and Arabic
// (TECH_STACK.md §5, ARCHITECTURE.md §9).
export function PhysicalLayout() {
  return (
    <div className="ml-4 pr-2 text-left">
      <span className="border-l-2">Breaks in RTL</span>
    </div>
  );
}
