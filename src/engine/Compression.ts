// Mirrors C++ Compression.h / Compression.cpp
// Supports both classic C++ .huf (v1) and upgraded HUF2 (Magic + Mode + Size + CRC32 + Canonical/Static + Smart Bypass)

import { computeCrc32 } from './CRC32';
import {
  assignCanonicalCodes,
  buildHuffmanTree,
  computeTreeBitLengths,
  generateCodes,
  limitBitLengths,
  serializeCanonicalHeaderBytes,
  serializeHuffmanTreeBytes,
} from './HuffmanTree';
import { HuffmanNode } from './Node';
import { formatByteLabel, HexSection, TraceLogger } from './TraceLogger';

export type ContainerFormat = 'huf2' | 'huf1';
export type CompressionModeId = 0 | 1 | 2; // 0 = Raw Bypass, 1 = Static Huffman, 2 = Canonical Huffman

export interface CompressionOptions {
  container?: ContainerFormat;
  mode?: CompressionModeId | 'auto';
  allowSmartBypass?: boolean;
  trace?: boolean;
  maxTraceEvents?: number;
}

export interface CompressionOutput {
  data: Uint8Array;
  container: ContainerFormat;
  modeUsed: CompressionModeId;
  modeName: string;
  smartBypassTriggered: boolean;
  originalSize: number;
  compressedSize: number;
  headerBytes: number;
  treeHeaderBytes: number;
  payloadBytes: number;
  crc32: number;
  durationMs: number;
  codes: string[];
  canonicalCodes: string[];
  freq: Uint32Array;
  root: HuffmanNode | null;
  logger: TraceLogger;
}

export function modeLabel(mode: CompressionModeId): string {
  if (mode === 0) return 'Raw Bypass (Mode 0)';
  if (mode === 1) return 'Static Huffman (Mode 1)';
  return 'Canonical Huffman (Mode 2)';
}

function writeUint64LE(val: number): number[] {
  const bytes = new Array<number>(8);
  let big = BigInt(val);
  for (let i = 0; i < 8; i++) {
    bytes[i] = Number(big & 0xffn);
    big >>= 8n;
  }
  return bytes;
}

function writeUint32LE(val: number): number[] {
  const v = val >>> 0;
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

function encodeWithMode(
  input: Uint8Array,
  container: ContainerFormat,
  mode: CompressionModeId,
  traceEnabled: boolean,
  maxTraceEvents: number
): CompressionOutput {
  const tStart = performance.now();
  const logger = new TraceLogger(traceEnabled, maxTraceEvents);

  // Pass 1: Frequency count + CRC32
  const freq = new Uint32Array(256);
  for (let i = 0; i < input.length; i++) {
    freq[input[i]]++;
  }
  const crc32 = computeCrc32(input);
  const originalSize = input.length;

  const outBytes: number[] = [];
  const pushByte = (b: number, section: HexSection, note: string): number => {
    const byteVal = b & 0xff;
    const offset = logger.recordHexByte(byteVal, section, note);
    outBytes.push(byteVal);
    return offset;
  };

  let headerBytes = 0;
  let treeHeaderBytes = 0;
  let payloadBytes = 0;
  let root: HuffmanNode | null = null;
  const staticCodes = new Array<string>(256).fill('');
  let canonicalCodes = new Array<string>(256).fill('');

  if (container === 'huf2') {
    // 4-byte Magic: "HUF2"
    ['H', 'U', 'F', '2'].forEach((ch, idx) =>
      pushByte(ch.charCodeAt(0), 'magic', `Magic byte [${idx}] = '${ch}'`)
    );
    // 1-byte Mode Flag
    pushByte(mode, 'mode', modeLabel(mode));
    // 8-byte uint64_t Original Size
    const sizeBytes = writeUint64LE(originalSize);
    sizeBytes.forEach((b, idx) =>
      pushByte(b, 'size', `Original size byte [${idx}] (uint64 LE = ${originalSize})`)
    );
    // 4-byte CRC32
    const crcBytes = writeUint32LE(crc32);
    crcBytes.forEach((b, idx) =>
      pushByte(b, 'crc', `CRC32 byte [${idx}]`)
    );
    headerBytes = 17;
  } else {
    // Classic team .huf v1: 8-byte uint64_t Original Size
    const sizeBytes = writeUint64LE(originalSize);
    sizeBytes.forEach((b, idx) =>
      pushByte(b, 'size', `Original size byte [${idx}] (uint64 LE = ${originalSize})`)
    );
    headerBytes = 8;
  }

  if (originalSize === 0) {
    const tEnd = performance.now();
    return {
      data: new Uint8Array(outBytes),
      container,
      modeUsed: container === 'huf2' ? 0 : mode,
      modeName: container === 'huf2' ? modeLabel(0) : modeLabel(1),
      smartBypassTriggered: false,
      originalSize: 0,
      compressedSize: outBytes.length,
      headerBytes,
      treeHeaderBytes: 0,
      payloadBytes: 0,
      crc32,
      durationMs: tEnd - tStart,
      codes: staticCodes,
      canonicalCodes,
      freq,
      root: null,
      logger,
    };
  }

  if (mode === 0 && container === 'huf2') {
    for (let i = 0; i < input.length; i++) {
      pushByte(input[i], 'payload', `Raw bypass byte [${i}] (${formatByteLabel(input[i])})`);
    }
    payloadBytes = input.length;
  } else {
    // Build MinHeap + Binary Huffman Tree
    root = buildHuffmanTree(freq, logger);
    generateCodes(root, '', staticCodes, mode === 1 ? logger : null);

    // Always compute Canonical codes so UI can show Static vs Canonical side by side
    const lengths = new Uint8Array(256);
    computeTreeBitLengths(root, lengths, 0);
    limitBitLengths(lengths, 28);
    canonicalCodes = assignCanonicalCodes(lengths);

    if (mode === 2 && logger.enabled) {
      for (let i = 0; i < 256; i++) {
        if (lengths[i] > 0) {
          logger.registerCode({
            character: i,
            label: formatByteLabel(i),
            freq: freq[i],
            code: canonicalCodes[i],
            canonicalCode: canonicalCodes[i],
            bitLength: lengths[i],
          });
          logger.logCodeAssign(i, freq[i], canonicalCodes[i]);
        }
      }
    } else if (logger.enabled) {
      // Attach canonical equivalent to static code entries
      for (const entry of logger.codes) {
        entry.canonicalCode = canonicalCodes[entry.character];
      }
    }

    // Write tree or canonical bit-length header
    if (mode === 1 || container === 'huf1') {
      const treeBytes = serializeHuffmanTreeBytes(root);
      treeBytes.forEach((b, idx) =>
        pushByte(
          b,
          'tree',
          `Preorder tree byte [${idx}]: ${b === 0 ? '0 (internal)' : b === 1 ? '1 (leaf marker)' : formatByteLabel(b)}`
        )
      );
      treeHeaderBytes = treeBytes.length;
    } else {
      const canonBytes = serializeCanonicalHeaderBytes(lengths);
      canonBytes.forEach((b, idx) =>
        pushByte(b, 'tree', `Canonical length table byte [${idx}]`)
      );
      treeHeaderBytes = canonBytes.length;
    }

    const activeCodes = mode === 2 && container === 'huf2' ? canonicalCodes : staticCodes;

    // Pass 2: MSB-first bitwise packing matching C++ Compression.cpp
    // bit_buffer = (bit_buffer << 1) | bit; flush every 8 bits
    const skipSingleCharPayload = container === 'huf2' && root !== null && root.isLeaf();
    if (!skipSingleCharPayload) {
      let bitBuffer = 0;
      let bitCount = 0;
      const beforePayload = outBytes.length;

      for (let i = 0; i < input.length; i++) {
        const byteVal = input[i];
        const code = activeCodes[byteVal];

        for (let c = 0; c < code.length; c++) {
          const bit: 0 | 1 = code[c] === '1' ? 1 : 0;
          bitBuffer = ((bitBuffer << 1) | bit) & 0xff;
          bitCount++;

          if (logger.enabled) {
            logger.logBitPush(bit, bitBuffer, bitCount, byteVal, code);
          }

          if (bitCount === 8) {
            const offset = pushByte(bitBuffer, 'payload', `Packed payload byte (8/8 bits)`);
            if (logger.enabled) {
              logger.logBitFlush(bitBuffer, offset, 'payload', false);
            }
            bitBuffer = 0;
            bitCount = 0;
          }
        }
      }

      if (bitCount > 0) {
        bitBuffer = (bitBuffer << (8 - bitCount)) & 0xff;
        const offset = pushByte(
          bitBuffer,
          'payload',
          `Final padded payload byte (${bitCount} valid bits + ${8 - bitCount} zero pad)`
        );
        if (logger.enabled) {
          logger.logBitFlush(bitBuffer, offset, 'payload', true);
        }
      }

      payloadBytes = outBytes.length - beforePayload;
    }
  }

  const tEnd = performance.now();
  return {
    data: new Uint8Array(outBytes),
    container,
    modeUsed: mode,
    modeName: modeLabel(mode),
    smartBypassTriggered: false,
    originalSize,
    compressedSize: outBytes.length,
    headerBytes,
    treeHeaderBytes,
    payloadBytes,
    crc32,
    durationMs: tEnd - tStart,
    codes: staticCodes,
    canonicalCodes,
    freq,
    root,
    logger,
  };
}

export function compressBytes(input: Uint8Array, options: CompressionOptions = {}): CompressionOutput {
  const container: ContainerFormat = options.container ?? 'huf2';
  const requestedMode = options.mode ?? 1;
  const allowSmartBypass = options.allowSmartBypass ?? false;
  const trace = options.trace ?? false;
  const maxTraceEvents = options.maxTraceEvents ?? 3500;

  let chosenMode: CompressionModeId = 1;

  if (container === 'huf1') {
    chosenMode = 1;
  } else if (requestedMode === 'auto') {
    const staticProbe = encodeWithMode(input, 'huf2', 1, false, 0);
    const canonProbe = encodeWithMode(input, 'huf2', 2, false, 0);
    chosenMode = canonProbe.compressedSize <= staticProbe.compressedSize ? 2 : 1;
  } else {
    chosenMode = requestedMode;
  }

  let result = encodeWithMode(input, container, chosenMode, trace, maxTraceEvents);

  if (
    container === 'huf2' &&
    allowSmartBypass &&
    chosenMode !== 0 &&
    input.length > 0 &&
    result.compressedSize >= input.length + 17
  ) {
    result = encodeWithMode(input, 'huf2', 0, trace, maxTraceEvents);
    result.smartBypassTriggered = true;
  }

  return result;
}
