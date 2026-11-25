export type HexSection = 'magic' | 'mode' | 'size' | 'crc' | 'tree' | 'payload';

export interface HeapSlotSnapshot {
  id: number;
  character: number;
  label: string;
  freq: number;
  isLeaf: boolean;
}

export interface TraceNodeInfo {
  id: number;
  character: number;
  label: string;
  freq: number;
  leftId: number | null;
  rightId: number | null;
  isLeaf: boolean;
}

export interface TraceCodeInfo {
  character: number;
  label: string;
  freq: number;
  code: string;
  canonicalCode?: string;
  bitLength: number;
}

export interface HexByteInfo {
  offset: number;
  value: number;
  section: HexSection;
  note: string;
}

export type TraceEventType =
  | 'HEAP_INSERT'
  | 'HEAP_SWAP'
  | 'EXTRACT_MERGE'
  | 'CODE_ASSIGN'
  | 'BIT_PUSH'
  | 'BIT_FLUSH'
  | 'DECODE_STEP'
  | 'DECODE_CHAR';

export type TracePhase = 'heap' | 'codes' | 'packing' | 'decode';

export interface TraceEvent {
  index: number;
  phase: TracePhase;
  type: TraceEventType;
  detail: string;
  idxA?: number;
  idxB?: number;
  swapDirection?: 'heapifyUp' | 'heapifyDown';
  leftId?: number;
  rightId?: number;
  parentId?: number;
  freq?: number;
  character?: number;
  label?: string;
  bit?: 0 | 1;
  bitBuffer?: number;
  bitCount?: number;
  byteVal?: number;
  hexOffset?: number;
  section?: HexSection;
  code?: string;
  fromId?: number;
  toId?: number;
  isLeaf?: boolean;
  decodedIndex?: number;
  heapSnapshot?: HeapSlotSnapshot[];
}

export function formatByteLabel(byteVal: number): string {
  const b = byteVal & 0xff;
  if (b === 10) return '\\n';
  if (b === 13) return '\\r';
  if (b === 9) return '\\t';
  if (b === 32) return 'SPACE';
  if (b >= 33 && b <= 126) return `'${String.fromCharCode(b)}'`;
  return `0x${b.toString(16).toUpperCase().padStart(2, '0')}`;
}

export class TraceLogger {
  public enabled: boolean;
  public maxEvents: number;
  private nextId = 1;

  public treeNodes: TraceNodeInfo[] = [];
  public codes: TraceCodeInfo[] = [];
  public hexBytes: HexByteInfo[] = [];
  public events: TraceEvent[] = [];
  public truncated = false;

  constructor(enabled = true, maxEvents = 3500) {
    this.enabled = enabled;
    this.maxEvents = maxEvents;
  }

  public allocateNodeId(): number {
    return this.nextId++;
  }

  public registerTreeNode(info: TraceNodeInfo): void {
    if (!this.enabled) return;
    this.treeNodes.push(info);
  }

  public registerCode(info: TraceCodeInfo): void {
    if (!this.enabled) return;
    this.codes.push(info);
  }

  public recordHexByte(value: number, section: HexSection, note: string): number {
    const offset = this.hexBytes.length;
    if (this.enabled && this.hexBytes.length < 16384) {
      this.hexBytes.push({ offset, value: value & 0xff, section, note });
    }
    return offset;
  }

  private pushEvent(ev: Omit<TraceEvent, 'index'>): void {
    if (!this.enabled) return;
    if (this.events.length >= this.maxEvents) {
      this.truncated = true;
      return;
    }
    this.events.push({ ...ev, index: this.events.length });
  }

  public logHeapInsert(insertedIndex: number, nodeId: number, character: number, freq: number, snapshot: HeapSlotSnapshot[]): void {
    this.pushEvent({
      phase: 'heap',
      type: 'HEAP_INSERT',
      detail: `Insert ${formatByteLabel(character)} (freq=${freq}) at heap[${insertedIndex}]`,
      idxA: insertedIndex,
      parentId: nodeId,
      character,
      label: formatByteLabel(character),
      freq,
      heapSnapshot: snapshot,
    });
  }

  public logHeapSwap(direction: 'heapifyUp' | 'heapifyDown', idxA: number, idxB: number, snapshot: HeapSlotSnapshot[]): void {
    this.pushEvent({
      phase: 'heap',
      type: 'HEAP_SWAP',
      swapDirection: direction,
      detail: `${direction}: swap heap[${idxA}] <-> heap[${idxB}]`,
      idxA,
      idxB,
      heapSnapshot: snapshot,
    });
  }

  public logExtractMerge(leftId: number, rightId: number, parentId: number, combinedFreq: number, snapshot: HeapSlotSnapshot[]): void {
    this.pushEvent({
      phase: 'heap',
      type: 'EXTRACT_MERGE',
      detail: `extractMin() pair (#${leftId}, #${rightId}) -> merge parent #${parentId} (freq=${combinedFreq})`,
      leftId,
      rightId,
      parentId,
      freq: combinedFreq,
      heapSnapshot: snapshot,
    });
  }

  public logCodeAssign(character: number, freq: number, code: string): void {
    this.pushEvent({
      phase: 'codes',
      type: 'CODE_ASSIGN',
      detail: `Assign prefix code ${formatByteLabel(character)} (freq=${freq}) -> ${code}`,
      character,
      label: formatByteLabel(character),
      freq,
      code,
    });
  }

  public logBitPush(bit: 0 | 1, bitBuffer: number, bitCount: number, character: number, code: string): void {
    this.pushEvent({
      phase: 'packing',
      type: 'BIT_PUSH',
      detail: `bit_buffer = (bit_buffer << 1) | ${bit}  [${bitCount}/8 bits] (${formatByteLabel(character)})`,
      bit,
      bitBuffer: bitBuffer & 0xff,
      bitCount,
      character,
      label: formatByteLabel(character),
      code,
    });
  }

  public logBitFlush(byteVal: number, hexOffset: number, section: HexSection, isPadding = false): void {
    const hex = '0x' + (byteVal & 0xff).toString(16).toUpperCase().padStart(2, '0');
    this.pushEvent({
      phase: 'packing',
      type: 'BIT_FLUSH',
      detail: isPadding
        ? `Pad & flush final bit_buffer -> ${hex} at offset ${hexOffset}`
        : `Flush full 8-bit register -> ${hex} at offset ${hexOffset}`,
      byteVal: byteVal & 0xff,
      bitBuffer: 0,
      bitCount: 0,
      hexOffset,
      section,
    });
  }

  public logDecodeStep(bit: 0 | 1, fromId: number, toId: number, isLeaf: boolean, character: number, decodedIndex: number): void {
    this.pushEvent({
      phase: 'decode',
      type: 'DECODE_STEP',
      detail: `Traverse bit ${bit} (${bit === 0 ? 'left' : 'right'}): #${fromId} -> #${toId}${isLeaf ? ` [LEAF ${formatByteLabel(character)}]` : ''}`,
      bit,
      fromId,
      toId,
      isLeaf,
      character,
      label: formatByteLabel(character),
      decodedIndex,
    });
  }

  public logDecodeChar(character: number, decodedIndex: number, nodeId: number): void {
    this.pushEvent({
      phase: 'decode',
      type: 'DECODE_CHAR',
      detail: `Emit decoded byte [${decodedIndex}] = ${formatByteLabel(character)}`,
      character,
      label: formatByteLabel(character),
      decodedIndex,
      toId: nodeId,
    });
  }
}
