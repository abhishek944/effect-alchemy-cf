/** Local Docker IDs are valid only in the fixed local stage, never a cloud deployment. */
export function officeImageReference(image: string, stage: string): boolean {
  return (
    /^registry\.cloudflare\.com\/[^\s@]+@sha256:[a-f0-9]{64}$/.test(image) ||
    (stage === "dev_local" && /^sha256:[a-f0-9]{64}$/.test(image))
  );
}
