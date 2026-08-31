import type { Sandbox } from "./types.js";
import { expandUserMessage } from "./images.js";

/** Expand `@path/to/file` tokens into inlined file bodies. Skips misses. Images are left as `[image path]` markers (see expandUserMessage). */
export async function expandAtMentions(text: string, sandbox: Sandbox): Promise<string> {
  return (await expandUserMessage(text, sandbox)).text;
}
