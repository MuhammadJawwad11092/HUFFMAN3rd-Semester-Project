// Mirrors C++ Decompression.h / Decompression.cpp
// Auto-detects both HUF2 container and classic C++ team .huf (v1) binary files.

import { CompressionModeId, ContainerFormat, modeLabel } from './Compression';
import { computeCrc32 } from './CRC32';
import {
  assignCanonicalCodes,
  buildCanonicalDecodeTree,
  ByteStreamCursor,
  deserializeHuffmanTree,
  readCanonicalHeader,
} from './HuffmanTree';
import { HuffmanNode } from './Node';
import { TraceLogger } from './TraceLogger';

export interface DecompressionOptions {
  logger?: TraceLogger | null;
}

export interface DecompressionOutput {
  success: boolean;
  data: Uint8Array;
  containerDetected: ContainerFormat;
  modeDetected: CompressionModeId;
  modeName: string;
  originalSize: number;
  expectedCrc32: number | null;
  computedCrc32: number;
  crcVerified: boolean | null;
  durationMs: number;
  errorMessage?: string;
}

function readUint64LE(data: Uint8Array, offset: number): number {
  let result = 0n;
  for (let i = 7; i >= 0; i--) {
    result = (result << 8n) | BigInt(data[offset + i]);
  }
  return Number(result);
}

function readUint32LE(data: Uint8Array, offset: number): number {
  return (
    (data[offset] |
      (data[offset + 1] << 8) |
      (data[offset + 2] << 16) |
      (data[offset + 3] << 24)) >>>
    0
  );
}

export function decompressBytes(
  compressed: Uint8Array,
  options: DecompressionOptions = {}
): DecompressionOutput {
  const tStart = performance.now();
  const logger = options.logger ?? null;

  const fail = (msg: string, container: ContainerFormat = 'huf2'): DecompressionOutput => ({
    success: false,
    data: new Uint8Array(0),
    containerDetected: container,
    modeDetected: 0,
    modeName: 'Unknown',
    originalSize: 0,
    expectedCrc32: null,
    computedCrc32: 0,
    crcVerified: null,
    durationMs: performance.now() - tStart,
    errorMessage: msg,
  });

  if (compressed.length === 0) {
    return {
      success: true,
      data: new Uint8Array(0),
      containerDetected: 'huf1',
      modeDetected: 1,
      modeName: modeLabel(1),
      originalSize: 0,
      expectedCrc32: null,
      computedCrc32: computeCrc32(new Uint8Array(0)),
      crcVerified: null,
      durationMs: performance.now() - tStart,
    };
  }

  const isHuf2 =
    compressed.length >= 4 &&
    compressed[0] === 0x48 && // 'H'
    compressed[1] === 0x55 && // 'U'
    compressed[2] === 0x46 && // 'F'
    compressed[3] === 0x32;   // '2'

  const container: ContainerFormat = isHuf2 ? 'huf2' : 'huf1';
  const cursor: ByteStreamCursor = { data: compressed, pos: 0 };

  let mode: CompressionModeId = 1;
  let originalSize = 0;
  let expectedCrc: number | null = null;

  if (isHuf2) {
    if (compressed.length < 17) {
      return fail('Truncated HUF2 header (expected at least 17 bytes).', 'huf2');
    }
    cursor.pos = 4;
    const modeByte = compressed[cursor.pos++];
    if (modeByte !== 0 && modeByte !== 1 && modeByte !== 2) {
      return fail(`Unsupported HUF2 mode flag (${modeByte}).`, 'huf2');
    }
    mode = modeByte;
    originalSize = readUint64LE(compressed, cursor.pos);
    cursor.pos += 8;
    expectedCrc = readUint32LE(compressed, cursor.pos);
    cursor.pos += 4;
  } else {
    if (compressed.length < 8) {
      return fail('Invalid .huf file: missing 8-byte original file size metadata.', 'huf1');
    }
    originalSize = readUint64LE(compressed, 0);
    cursor.pos = 8;
    mode = 1;
  }

  if (!Number.isSafeInteger(originalSize) || originalSize < 0) {
    return fail('Corrupted original file size in header.', container);
  }

  if (originalSize === 0) {
    const empty = new Uint8Array(0);
    const computedCrc = computeCrc32(empty);
    const crcOk = expectedCrc === null ? null : computedCrc === expectedCrc;
    return {
      success: crcOk !== false,
      data: empty,
      containerDetected: container,
      modeDetected: mode,
      modeName: modeLabel(mode),
      originalSize: 0,
      expectedCrc32: expectedCrc,
      computedCrc32: computedCrc,
      crcVerified: crcOk,
      durationMs: performance.now() - tStart,
      errorMessage: crcOk === false ? 'CRC32 mismatch on empty payload.' : undefined,
    };
  }

  const output = new Uint8Array(originalSize);

  if (mode === 0) {
    if (cursor.pos + originalSize > compressed.length) {
      return fail('Unexpected EOF in Raw Bypass payload.', container);
    }
    output.set(compressed.subarray(cursor.pos, cursor.pos + originalSize));
  } else {
    let root: HuffmanNode | null = null;
    if (mode === 1) {
      // Only register tree nodes into logger if logger doesn't already have them from compress phase
      const decodeLogger = logger && logger.treeNodes.length === 0 ? logger : null;
      root = deserializeHuffmanTree(cursor, decodeLogger);
    } else {
      const lengths = readCanonicalHeader(cursor);
      if (!lengths) {
        return fail('Failed to read Canonical Huffman bit-length header.', container);
      }
      const codes = assignCanonicalCodes(lengths);
      const decodeLogger = logger && logger.treeNodes.length === 0 ? logger : null;
      root = buildCanonicalDecodeTree(lengths, codes, decodeLogger);
    }

    if (!root) {
      return fail('Failed to reconstruct Huffman tree from header.', container);
    }

    // Build an ID lookup when compression already populated treeNodes so DECODE_STEP matches the rendered SVG nodes!
    const traceRootIdMap = new Map<number, number>();
    if (logger && logger.treeNodes.length > 0) {
      // Map decoded tree structure to existing TraceLogger node IDs by walking both trees or using leaf characters
      const leafIdByChar = new Map<number, number>();
      for (const tn of logger.treeNodes) {
        if (tn.isLeaf) leafIdByChar.set(tn.character, tn.id);
      }
      const byId = new Map<number, typeof logger.treeNodes[number]>();
      for (const tn of logger.treeNodes) byId.set(tn.id, tn);

      // Find actual root in logger.treeNodes (node with no parent)
      const hasParent = new Set<number>();
      for (const tn of logger.treeNodes) {
        if (tn.leftId !== null) hasParent.add(tn.leftId);
        if (tn.rightId !== null) hasParent.add(tn.rightId);
      }
      const loggedRoot = logger.treeNodes.find((tn) => !hasParent.has(tn.id));

      if (loggedRoot && mode === 1) {
        const align = (decNode: HuffmanNode | null, logId: number | null) => {
          if (!decNode || logId === null) return;
          traceRootIdMap.set(decNode.id, logId);
          decNode.id = logId;
          const logNode = byId.get(logId);
          if (logNode) {
            align(decNode.left, logNode.leftId);
            align(decNode.right, logNode.rightId);
          }
        };
        align(root, loggedRoot.id);
      } else {
        // For canonical decode tree, align leaves by character
        const assignFallback = (n: HuffmanNode | null) => {
          if (!n) return;
          if (n.isLeaf() && leafIdByChar.has(n.character)) {
            n.id = leafIdByChar.get(n.character)!;
          }
          assignFallback(n.left);
          assignFallback(n.right);
        };
        assignFallback(root);
      }
    }

    if (root.isLeaf()) {
      output.fill(root.character);
      if (logger?.enabled) {
        for (let i = 0; i < Math.min(originalSize, 32); i++) {
          logger.logDecodeChar(root.character, i, root.id);
        }
      }
    } else {
      let decodedCount = 0;
      let curr: HuffmanNode = root;

      while (decodedCount < originalSize && cursor.pos < compressed.length) {
        const currentByte = compressed[cursor.pos++];

        for (let bitIndex = 7; bitIndex >= 0; bitIndex--) {
          const bitVal: 0 | 1 = ((currentByte >> bitIndex) & 1) === 1 ? 1 : 0;
          const next = bitVal === 0 ? curr.left : curr.right;
          if (!next) {
            return fail('Corrupted bitstream encountered during tree traversal.', container);
          }

          if (logger?.enabled) {
            logger.logDecodeStep(
              bitVal,
              curr.id,
              next.id,
              next.isLeaf(),
              next.character,
              decodedCount
            );
          }

          curr = next;
          if (curr.isLeaf()) {
            output[decodedCount] = curr.character;
            if (logger?.enabled) {
              logger.logDecodeChar(curr.character, decodedCount, curr.id);
            }
            decodedCount++;
            curr = root;

            if (decodedCount === originalSize) {
              break;
            }
          }
        }
      }

      if (decodedCount !== originalSize) {
        return fail(
          `Decompressed size (${decodedCount} B) does not match header size (${originalSize} B).`,
          container
        );
      }
    }
  }

  const computedCrc = computeCrc32(output);
  const crcVerified = expectedCrc === null ? null : computedCrc === expectedCrc;
  if (crcVerified === false) {
    return {
      success: false,
      data: output,
      containerDetected: container,
      modeDetected: mode,
      modeName: modeLabel(mode),
      originalSize,
      expectedCrc32: expectedCrc,
      computedCrc32: computedCrc,
      crcVerified: false,
      durationMs: performance.now() - tStart,
      errorMessage: 'CRC32 integrity check failed — file may be corrupted.',
    };
  }

  return {
    success: true,
    data: output,
    containerDetected: container,
    modeDetected: mode,
    modeName: modeLabel(mode),
    originalSize,
    expectedCrc32: expectedCrc,
    computedCrc32: computedCrc,
    crcVerified,
    durationMs: performance.now() - tStart,
  };
}
