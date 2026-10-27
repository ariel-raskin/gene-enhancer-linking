const MAX_TEXT_BYTES = 300 * 1024 * 1024;

/** Read a selected local text file; gzip streams are decoded locally with a decompressed-size ceiling. */
export async function readLocalText(file: File, maxBytes = MAX_TEXT_BYTES): Promise<string> {
  if (!/\.gz$/i.test(file.name)) {
    if (file.size > maxBytes) throw new Error(`${file.name} exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB text import limit.`);
    return file.text();
  }
  if (typeof DecompressionStream === "undefined") throw new Error(`This browser cannot locally decompress ${file.name}. Select the uncompressed text file instead.`);
  const reader = file.stream().pipeThrough(new DecompressionStream("gzip")).getReader(); const decoder = new TextDecoder(); let output = ""; let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.byteLength; if (bytes > maxBytes) throw new Error(`${file.name} decompresses beyond the ${Math.round(maxBytes / 1024 / 1024)} MB text import limit.`);
      output += decoder.decode(value, { stream: true });
    }
    return output + decoder.decode();
  } finally { await reader.cancel().catch(() => undefined); }
}
