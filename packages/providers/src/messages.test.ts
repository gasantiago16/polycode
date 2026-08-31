import { describe, expect, it } from "vitest";
import { toModelMessages } from "./ai-sdk-provider.js";
import type { GenerateRequest } from "@polycode/core";

describe("toModelMessages", () => {
  it("maps user image parts to AI SDK image parts", () => {
    const req: GenerateRequest = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "what is this" },
            { type: "image", mediaType: "image/png", data: Buffer.from("hi").toString("base64"), path: "a.png" },
          ],
        },
      ],
      tools: [],
    };
    const out = toModelMessages(req);
    expect(out).toHaveLength(1);
    const content = out[0].content as Array<{ type: string; text?: string; image?: Buffer; mediaType?: string }>;
    expect(content[0]).toEqual({ type: "text", text: "what is this" });
    expect(content[1].type).toBe("image");
    expect(content[1].mediaType).toBe("image/png");
    expect(Buffer.isBuffer(content[1].image)).toBe(true);
  });
});
