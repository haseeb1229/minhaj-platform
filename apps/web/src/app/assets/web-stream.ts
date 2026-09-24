/**
 * Bridges Storage's async iterable onto the Web `ReadableStream` a `Response`
 * wants — ONE implementation for every byte route under `/assets`.
 *
 * STREAMED, NEVER BUFFERED. A scanned edition PDF or a long lecture recording
 * can be tens of megabytes, and reading one into memory to hand it back would
 * put the whole file in the server's heap per concurrent reader. Each `pull`
 * takes one chunk from disk.
 *
 * A MID-FLIGHT FAILURE ERRORS THE STREAM rather than closing it. Closing would
 * deliver a shorter file that looks complete, which is a corrupt download the
 * reader has no way to detect.
 *
 * A CANCELLED RESPONSE CLOSES THE FILE. A player that seeks abandons the range
 * it was reading; `cancel` returns the iterator so the underlying read stream is
 * released rather than left open until it drains.
 */
export function toWebStream(body: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  const iterator = body[Symbol.asyncIterator]();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await iterator.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}
