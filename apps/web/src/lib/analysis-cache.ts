import { readLocalText } from "./read-local-text";
export type SignalBlock = { start: number; end: number; score: number };
/** One experiment worker owns exact File references; no filename-based cache identity. */
export class AnalysisCache {
  private text = new Map<File, string>();
  private blocks = new Map<File, { key: string; value: SignalBlock[] }>();
  textBytes = 0; blockBytes = 0; hits = 0;
  async readText(file: File) {
    const value = this.text.get(file);
    if (value !== undefined) { this.hits++; return value; }
    const text = await readLocalText(file);
    const bytes = text.length * 2;
    if (bytes <= 2 * 1024 * 1024) {
      while (this.textBytes + bytes > 8 * 1024 * 1024 && this.text.size) { const first = this.text.keys().next().value!; this.textBytes -= this.text.get(first)!.length * 2; this.text.delete(first); }
      this.text.set(file, text); this.textBytes += bytes;
    }
    return text;
  }
  getBlocks(file: File, key: string) { const entry = this.blocks.get(file); if (entry?.key === key) { this.hits++; return entry.value; } }
  setBlocks(file: File, key: string, value: SignalBlock[]) {
    const bytes = value.length * 128;
    if (bytes > 16 * 1024 * 1024) return;
    const prev = this.blocks.get(file); if (prev) { this.blockBytes -= prev.value.length * 128; this.blocks.delete(file); }
    while (this.blockBytes + bytes > 16 * 1024 * 1024 && this.blocks.size) { const first = this.blocks.keys().next().value!; this.blockBytes -= this.blocks.get(first)!.value.length * 128; this.blocks.delete(first); }
    this.blocks.set(file, { key, value }); this.blockBytes += bytes;
  }
}
