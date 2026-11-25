// Mirrors C++ Node.h / Node.cpp
// Represents a leaf (byte 0..255) or internal merge node in the Binary Huffman Tree.

export class HuffmanNode {
  public character: number; // 0..255 unsigned byte value (0 for internal nodes)
  public freq: number;
  public id: number; // Unique ID for X-Ray TraceLogger & SVG tree tracking
  public left: HuffmanNode | null = null;
  public right: HuffmanNode | null = null;

  constructor(character = 0, freq = 0, id = 0) {
    this.character = character & 0xff;
    this.freq = freq;
    this.id = id;
  }

  public isLeaf(): boolean {
    return this.left === null && this.right === null;
  }
}
