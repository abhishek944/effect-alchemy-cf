/** Read the original stream without teeing; cancel immediately on overflow. */
export const readBoundedBody = async (
  request: Request,
  limit: number,
): Promise<Uint8Array | null> => {
  const source: ReadableStream<Uint8Array> | null = request.body;
  if (source === null) return new Uint8Array(0);
  const reader = source.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      void reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
};
