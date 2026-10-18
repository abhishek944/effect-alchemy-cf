/**
 * Canonical fingerprinting for frozen speech operation identity.
 *
 * Every part is length-prefixed before hashing, so two different part sequences
 * can never produce the same digest. The digest binds an authenticated
 * operation id to its exact saved preferences and input, which lets the durable
 * claim reject a mismatched replay instead of paying for a second attempt.
 */
export const fingerprintSpeech = async (
  parts: readonly (string | Uint8Array)[],
): Promise<string> => {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (const part of parts) {
    const bytes = typeof part === "string" ? encoder.encode(part) : part;
    chunks.push(encoder.encode(`${bytes.byteLength}:`), bytes);
    size += bytes.byteLength + String(bytes.byteLength).length + 1;
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};
