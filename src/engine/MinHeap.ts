// Mirrors C++ MinHeap.h / MinHeap.cpp
// Fixed 256-slot array-backed Min-Heap with exact heapifyUp / heapifyDown index math.

import { HuffmanNode } from './Node';
import { formatByteLabel, HeapSlotSnapshot, TraceLogger } from './TraceLogger';

export class MinHeap {
  public static readonly CAPACITY = 256;
  private heap: Array<HuffmanNode | null> = new Array(MinHeap.CAPACITY).fill(null);
  private size = 0;
  private logger: TraceLogger | null;

  constructor(logger: TraceLogger | null = null) {
    this.logger = logger;
  }

  public getSize(): number {
    return this.size;
  }

  public getSnapshot(): HeapSlotSnapshot[] {
    const snap: HeapSlotSnapshot[] = [];
    for (let i = 0; i < this.size; i++) {
      const n = this.heap[i];
      if (n) {
        snap.push({
          id: n.id,
          character: n.character,
          label: n.isLeaf() ? formatByteLabel(n.character) : `Merge #${n.id}`,
          freq: n.freq,
          isLeaf: n.isLeaf(),
        });
      }
    }
    return snap;
  }

  public insert(newNode: HuffmanNode, silent = false): void {
    if (this.size >= MinHeap.CAPACITY) return;
    this.heap[this.size] = newNode;
    const insertedIdx = this.size;
    this.size++;
    if (!silent && this.logger?.enabled && newNode.isLeaf()) {
      this.logger.logHeapInsert(insertedIdx, newNode.id, newNode.character, newNode.freq, this.getSnapshot());
    }
    this.heapifyUp(this.size - 1);
  }

  public extractMin(): HuffmanNode | null {
    if (this.size === 0) return null;

    const minNode = this.heap[0];
    this.heap[0] = this.heap[this.size - 1];
    this.heap[this.size - 1] = null;
    this.size--;

    if (this.size > 0) {
      this.heapifyDown(0);
    }

    return minNode;
  }

  public heapifyUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      const cur = this.heap[index]!;
      const par = this.heap[parentIndex]!;

      if (cur.freq < par.freq) {
        this.heap[index] = par;
        this.heap[parentIndex] = cur;

        if (this.logger?.enabled) {
          this.logger.logHeapSwap('heapifyUp', index, parentIndex, this.getSnapshot());
        }
        index = parentIndex;
      } else {
        break;
      }
    }
  }

  public heapifyDown(index: number): void {
    while (true) {
      const leftChild = 2 * index + 1;
      const rightChild = 2 * index + 2;
      let smallest = index;

      if (leftChild < this.size && this.heap[leftChild]!.freq < this.heap[smallest]!.freq) {
        smallest = leftChild;
      }
      if (rightChild < this.size && this.heap[rightChild]!.freq < this.heap[smallest]!.freq) {
        smallest = rightChild;
      }

      if (smallest === index) break;

      const temp = this.heap[index];
      this.heap[index] = this.heap[smallest];
      this.heap[smallest] = temp;

      if (this.logger?.enabled) {
        this.logger.logHeapSwap('heapifyDown', index, smallest, this.getSnapshot());
      }
      index = smallest;
    }
  }
}
