// FIXTURE — EXPECTED TO PASS.
// The logical equivalents, plus direction-neutral utilities which must not be
// caught by the rule.
export function LogicalLayout() {
  return (
    <div className="ms-4 pe-2 text-start">
      <span className="border-s-2 mt-4 w-full text-sm">Correct in RTL</span>
    </div>
  );
}
