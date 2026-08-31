/** Buffer streaming text so Ink does not re-layout Markdown on every token. */
export function createPaintBuffer(flush: (chunk: string) => void, intervalMs = 100) {
  let buf = "";
  let paints = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  const drip = () => {
    if (!buf) return;
    const chunk = buf;
    buf = "";
    paints++;
    flush(chunk);
  };

  return {
    push(delta: string) {
      buf += delta;
      if (!timer) timer = setInterval(drip, intervalMs);
    },
    /** Emit any remainder (tool call, stop, interrupt). */
    flush() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      drip();
    },
    get paintCount() {
      return paints;
    },
  };
}
