import React from 'react';
import { HeapSlotSnapshot, TraceEvent } from '../engine/TraceLogger';

interface MinHeapVisualizerProps {
  heap: HeapSlotSnapshot[];
  activeEvent: TraceEvent | null;
}

export const MinHeapVisualizer: React.FC<MinHeapVisualizerProps> = ({ heap, activeEvent }) => {
  const isSwap = activeEvent?.type === 'HEAP_SWAP';
  const isInsert = activeEvent?.type === 'HEAP_INSERT';
  const isMerge = activeEvent?.type === 'EXTRACT_MERGE';

  return (
    <div className="flex flex-col h-full bg-[#111827] border border-[#233047] rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#233047]">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">Min-Heap Backing Array</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            256-slot array · parent = ⌊(i−1)/2⌋ · children = 2i+1, 2i+2
          </p>
        </div>
        <div className="text-xs font-mono text-slate-300">
          size: <span className="text-sky-400 font-semibold">{heap.length}</span> / 256
        </div>
      </div>

      <div className="p-4 flex-1 overflow-y-auto">
        {heap.length === 0 ? (
          <div className="h-48 flex flex-col items-center justify-center text-center text-slate-400 text-xs border border-dashed border-[#233047] rounded-lg p-6">
            <p className="text-slate-300 font-medium mb-1">Heap array is empty</p>
            <p>All nodes have been extracted and merged into the final root of the Huffman Tree.</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2.5">
            {heap.map((slot, idx) => {
              const swapped = isSwap && (idx === activeEvent?.idxA || idx === activeEvent?.idxB);
              const inserted = isInsert && idx === activeEvent?.idxA;
              const merged = isMerge && slot.id === activeEvent?.parentId;

              let borderClass = 'border-[#233047] bg-[#0D131F]';
              let statusLabel = '';
              let statusColor = 'text-slate-500';

              if (swapped) {
                borderClass = 'border-amber-400/80 bg-amber-500/12';
                statusLabel = activeEvent?.swapDirection === 'heapifyUp' ? 'SWAP UP' : 'SWAP DN';
                statusColor = 'text-amber-300';
              } else if (merged) {
                borderClass = 'border-emerald-400/80 bg-emerald-500/12';
                statusLabel = 'MERGED';
                statusColor = 'text-emerald-300';
              } else if (inserted) {
                borderClass = 'border-sky-400/80 bg-sky-500/12';
                statusLabel = 'INSERT';
                statusColor = 'text-sky-300';
              }

              const parentIdx = idx > 0 ? Math.floor((idx - 1) / 2) : null;

              return (
                <div
                  key={`${idx}-${slot.id}`}
                  className={`border rounded-lg p-2.5 transition-transform duration-150 ${borderClass} ${
                    swapped || merged ? '-translate-y-0.5' : ''
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px] font-mono">
                    <span className="text-slate-400">[{idx}]</span>
                    <span className={statusColor}>{statusLabel || `#${slot.id}`}</span>
                  </div>
                  <div className="mt-1.5 text-sm font-mono font-semibold text-slate-100 truncate">
                    {slot.label}
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] font-mono text-slate-400">
                    <span>f={slot.freq}</span>
                    {parentIdx !== null ? <span>p:[{parentIdx}]</span> : <span>root</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
