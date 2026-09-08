// FIXTURE — MUST FAIL. Review bypasses: important prefix and suffix, arbitrary
// variant, state variant, negative arbitrary value.
export function ViaVariants() {
  return (
    <div className="!ml-4">
      <span className="md:!text-left">important variant</span>
      <span className="[&>*]:pl-2">arbitrary variant</span>
      <span className="group-hover:-mr-[3px]">negative arbitrary</span>
      <span className="ml-2!">important suffix</span>
    </div>
  );
}
