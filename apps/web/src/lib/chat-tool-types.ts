/** Bounded owner-visible excerpts, not the native tool record or an execution API. */
export type ChatTool = {
  id: string;
  name: string;
  status: "pending" | "running" | "succeeded" | "failed" | "cancelled" | "unknown";
  /** UTF-16 public-text units preceding this call in its assistant message. */
  textOffset: number;
  input: string;
  output: string | null;
  inputTruncated: boolean;
  outputTruncated: boolean;
};
