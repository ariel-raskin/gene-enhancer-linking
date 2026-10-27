import { describe, expect, it } from "vitest";
import { readLocalText } from "./read-local-text";

describe("local text decoder", () => {
  it("reads plain text and browser-decompressible gzip locally", async () => {
    const text = "a\tb\n1\t2\n";
    const compressed = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
    expect(await readLocalText(new File([text], "table.tsv"))).toBe(text);
    expect(await readLocalText(new File([compressed], "table.tsv.gz"))).toBe(text);
  });

  it("enforces the decompressed size ceiling", async () => {
    const text = "x".repeat(128);
    const compressed = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
    await expect(readLocalText(new File([compressed], "large.tsv.gz"), 32)).rejects.toThrow("decompresses beyond");
  });
});
