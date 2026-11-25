// Mirrors C++ HuffmanTree.h / HuffmanTree.cpp + Canonical Huffman upgrade

import { HuffmanNode } from './Node';
import { MinHeap } from './MinHeap';
import { formatByteLabel, TraceLogger } from './TraceLogger';

export function generateCodes(
  root: HuffmanNode | null,
  code: string,
  codes: string[],
  logger: TraceLogger | null = null
): void {
  if (!root) return;

  if (root.isLeaf()) {
    const finalCode = code === '' ? '0' : code;
    codes[root.character] = finalCode;
    if (logger?.enabled) {
      logger.registerCode({
        character: root.character,
        label: formatByteLabel(root.character),
        freq: root.freq,
        code: finalCode,
        bitLength: finalCode.length,
      });
      logger.logCodeAssign(root.character, root.freq, finalCode);
    }
    return;
  }

  generateCodes(root.left, code + '0', codes, logger);
  generateCodes(root.right, code + '1', codes, logger);
}

export function buildHuffmanTree(
  freq: number[] | Uint32Array,
  logger: TraceLogger | null = null
): HuffmanNode | null {
  const myMinHeap = new MinHeap(logger);
  let localId = 1;

  for (let i = 0; i < 256; i++) {
    if (freq[i] > 0) {
      const nid = logger?.enabled ? logger.allocateNodeId() : localId++;
      const leaf = new HuffmanNode(i, freq[i], nid);
      if (logger?.enabled) {
        logger.registerTreeNode({
          id: nid,
          character: i,
          label: formatByteLabel(i),
          freq: freq[i],
          leftId: null,
          rightId: null,
          isLeaf: true,
        });
      }
      myMinHeap.insert(leaf);
    }
  }

  if (myMinHeap.getSize() === 0) return null;

  while (myMinHeap.getSize() > 1) {
    const leftNode = myMinHeap.extractMin()!;
    const rightNode = myMinHeap.extractMin()!;

    const pid = logger?.enabled ? logger.allocateNodeId() : localId++;
    const combinedFreq = leftNode.freq + rightNode.freq;
    const parent = new HuffmanNode(0, combinedFreq, pid);
    parent.left = leftNode;
    parent.right = rightNode;

    if (logger?.enabled) {
      logger.registerTreeNode({
        id: pid,
        character: 0,
        label: `#${pid}`,
        freq: combinedFreq,
        leftId: leftNode.id,
        rightId: rightNode.id,
        isLeaf: false,
      });
    }

    myMinHeap.insert(parent, true);

    if (logger?.enabled) {
      logger.logExtractMerge(
        leftNode.id,
        rightNode.id,
        pid,
        combinedFreq,
        myMinHeap.getSnapshot()
      );
    }
  }

  return myMinHeap.extractMin();
}

// Preorder serialization matching C++: 0 = internal node, 1 + char = leaf node
export function serializeHuffmanTreeBytes(root: HuffmanNode | null): number[] {
  const out: number[] = [];
  function walk(node: HuffmanNode | null): void {
    if (!node) return;
    if (node.isLeaf()) {
      out.push(1);
      out.push(node.character & 0xff);
    } else {
      out.push(0);
      walk(node.left);
      walk(node.right);
    }
  }
  walk(root);
  return out;
}

export interface ByteStreamCursor {
  data: Uint8Array;
  pos: number;
}

export function deserializeHuffmanTree(
  cursor: ByteStreamCursor,
  logger: TraceLogger | null = null
): HuffmanNode | null {
  if (cursor.pos >= cursor.data.length) return null;
  const marker = cursor.data[cursor.pos++];

  if (marker === 1) {
    if (cursor.pos >= cursor.data.length) return null;
    const ch = cursor.data[cursor.pos++];
    const nid = logger?.enabled ? logger.allocateNodeId() : 0;
    const leaf = new HuffmanNode(ch, 0, nid);
    if (logger?.enabled) {
      logger.registerTreeNode({
        id: nid,
        character: ch,
        label: formatByteLabel(ch),
        freq: 0,
        leftId: null,
        rightId: null,
        isLeaf: true,
      });
    }
    return leaf;
  }

  if (marker === 0) {
    const nid = logger?.enabled ? logger.allocateNodeId() : 0;
    const internal = new HuffmanNode(0, 0, nid);
    internal.left = deserializeHuffmanTree(cursor, logger);
    internal.right = deserializeHuffmanTree(cursor, logger);
    if (!internal.left || !internal.right) {
      return null;
    }
    if (logger?.enabled) {
      logger.registerTreeNode({
        id: nid,
        character: 0,
        label: `#${nid}`,
        freq: 0,
        leftId: internal.left.id,
        rightId: internal.right.id,
        isLeaf: false,
      });
    }
    return internal;
  }

  return null;
}

// ============================================================================
// Canonical Huffman Upgrade
// ============================================================================

export function computeTreeBitLengths(
  root: HuffmanNode | null,
  lengths: Uint8Array,
  depth = 0
): void {
  if (!root) return;
  if (root.isLeaf()) {
    lengths[root.character] = depth === 0 ? 1 : depth;
    return;
  }
  computeTreeBitLengths(root.left, lengths, depth + 1);
  computeTreeBitLengths(root.right, lengths, depth + 1);
}

export function limitBitLengths(lengths: Uint8Array, maxBits = 28): void {
  let clamped = false;
  for (let i = 0; i < lengths.length; i++) {
    if (lengths[i] > maxBits) {
      lengths[i] = maxBits;
      clamped = true;
    }
  }
  if (!clamped) return;

  const maxKraft = Math.pow(2, maxBits);
  const calcKraft = (): number => {
    let sum = 0;
    for (let i = 0; i < lengths.length; i++) {
      if (lengths[i] > 0) {
        sum += Math.pow(2, maxBits - lengths[i]);
      }
    }
    return sum;
  };

  let kraft = calcKraft();
  while (kraft > maxKraft) {
    let bestIdx = -1;
    let bestLen = 0;
    for (let i = 0; i < lengths.length; i++) {
      if (lengths[i] > 0 && lengths[i] < maxBits && lengths[i] > bestLen) {
        bestLen = lengths[i];
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break;
    lengths[bestIdx]++;
    kraft -= Math.pow(2, maxBits - lengths[bestIdx]);
  }
}

export function assignCanonicalCodes(lengths: Uint8Array): string[] {
  const active: Array<{ len: number; sym: number }> = [];
  for (let i = 0; i < lengths.length; i++) {
    if (lengths[i] > 0) {
      active.push({ len: lengths[i], sym: i });
    }
  }
  active.sort((a, b) => a.len - b.len || a.sym - b.sym);

  const codes = new Array<string>(256).fill('');
  let code = 0;
  let prevLen = 0;

  for (const entry of active) {
    if (prevLen > 0) {
      code = code * Math.pow(2, entry.len - prevLen);
    }
    codes[entry.sym] = code.toString(2).padStart(entry.len, '0');
    code++;
    prevLen = entry.len;
  }

  return codes;
}

export function buildCanonicalDecodeTree(
  lengths: Uint8Array,
  codes: string[],
  logger: TraceLogger | null = null
): HuffmanNode {
  let localId = 1;
  const alloc = () => (logger?.enabled ? logger.allocateNodeId() : localId++);
  const root = new HuffmanNode(0, 0, alloc());

  const activeSyms: number[] = [];
  for (let s = 0; s < 256; s++) {
    if (lengths[s] > 0) activeSyms.push(s);
  }

  if (activeSyms.length === 1) {
    const s = activeSyms[0];
    root.character = s;
    return root;
  }

  for (const s of activeSyms) {
    const codeStr = codes[s];
    let curr = root;
    for (let i = 0; i < codeStr.length; i++) {
      if (codeStr[i] === '0') {
        if (!curr.left) {
          curr.left = new HuffmanNode(0, 0, alloc());
        }
        curr = curr.left;
      } else {
        if (!curr.right) {
          curr.right = new HuffmanNode(0, 0, alloc());
        }
        curr = curr.right;
      }
    }
    curr.character = s;
  }

  return root;
}

export function serializeCanonicalHeaderBytes(lengths: Uint8Array): number[] {
  const active: Array<{ sym: number; len: number }> = [];
  for (let i = 0; i < 256; i++) {
    if (lengths[i] > 0) active.push({ sym: i, len: lengths[i] });
  }

  const out: number[] = [];
  if (active.length <= 127) {
    out.push(1); // Sparse bit-lengths mode
    out.push(active.length);
    for (const item of active) {
      out.push(item.sym);
      out.push(item.len);
    }
  } else {
    out.push(0); // Dense 256-byte bit-lengths table
    for (let i = 0; i < 256; i++) {
      out.push(lengths[i]);
    }
  }
  return out;
}

export function readCanonicalHeader(cursor: ByteStreamCursor): Uint8Array | null {
  if (cursor.pos >= cursor.data.length) return null;
  const lengths = new Uint8Array(256);
  const mode = cursor.data[cursor.pos++];

  if (mode === 1) {
    if (cursor.pos >= cursor.data.length) return null;
    const count = cursor.data[cursor.pos++];
    for (let k = 0; k < count; k++) {
      if (cursor.pos + 1 >= cursor.data.length) return null;
      const sym = cursor.data[cursor.pos++];
      const len = cursor.data[cursor.pos++];
      lengths[sym] = len;
    }
    return lengths;
  }

  if (mode === 0) {
    if (cursor.pos + 256 > cursor.data.length) return null;
    for (let i = 0; i < 256; i++) {
      lengths[i] = cursor.data[cursor.pos++];
    }
    return lengths;
  }

  return null;
}
