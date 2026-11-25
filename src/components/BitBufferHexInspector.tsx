import React, { useState } from 'react';
import { Download } from 'lucide-react';
import { HexByteInfo, HexSection, TraceEvent } from '../engine/TraceLogger';

interface BitBufferHexInspectorProps {
  bitBuffer: number;
  bitCount: number;
  hexBytes: HexByteInfo[];
  flushedCount: number;
  activeEvent: TraceEvent | null;
  onDownloadHuf: () => void;
  onJumpToOffset?: (offset: number) => void;
}

const SECTION_STYLES: Record<HexSection, { bg: string; label: string; dot: string }> = {
  magic: {
    bg: 'bg-violet-500/18 text-violet-200 border-violet-500/40',
    label: 'Magic (HUF2)',
    dot: 'bg-violet-400',
  },
  mode: {
    bg: 'bg-rose-500/18 text-rose-200 border-rose-500/40',
    label: 'Mode Flag',
    dot: 'bg-rose-400',
  },
  size: {
    bg: 'bg-blue-500/18 text-blue-200 border-blue-500/40',
    label: 'Original Size (uint64)',
    dot: 'bg-blue-400',
  },
  crc: {
    bg: 'bg-amber-500/18 text-amber-200 border-amber-500/40',
    label: 'CRC32 Checksum',
    dot: 'bg-amber-400',
  },
  tree: {
    bg: 'bg-emerald-500/18 text-emerald-200 border-emerald-500/40',
    label: 'Tree / Bit-Lengths',
    dot: 'bg-emerald-400',
  },
  payload: {
    bg: 'bg-sky-500/16 text-sky-200 border-sky-500/35',
    label: 'Packed Payload',
    dot: 'bg-sky-400',
  },
};

export const BitBufferHexInspector: React.FC<BitBufferHexInspectorProps> = ({
  bitBuffer,
  bitCount,
  hexBytes,
  flushedCount,
  activeEvent,
  onDownloadHuf,
  onJumpToOffset,
}) => {
  const [selectedByte, setSelectedByte] = useState<HexByteInfo | null>(null);

  const hexReg = '0x' + (bitBuffer & 0xff).toString(16).toUpperCase().padStart(2, '0');
  const activeHexCursor =
    activeEvent?.type === 'BIT_FLUSH' && activeEvent.hexOffset !== undefined
      ? activeEvent.hexOffset
      : flushedCount > 0
      ? flushedCount - 1
      : -1;

  // Group hex bytes into 16-byte rows for clean hex-editor layout
  const visibleLimit = Math.min(hexBytes.length, 512);
  const rows: HexByteInfo[][] = [];
  for (let i = 0; i < visibleLimit; i += 16) {
    rows.push(hexBytes.slice(i, Math.min(i + 16, visibleLimit)));
  }

  return (
    <div className="bg-[#111827] border border-[#233047] rounded-xl overflow-hidden flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-[#233047]">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">
            8-Bit Shift Register &amp; .huf Binary Hex Inspector
          </h3>
          <p className="text-xs text-slate-400 mt-0.5 font-mono">
            bit_buffer = (bit_buffer &lt;&lt; 1) | bit · {hexBytes.length} bytes total
          </p>
        </div>

        <button
          type="button"
          onClick={onDownloadHuf}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors whitespace-nowrap shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
          Download .huf
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Live 8-bit Shift Register */}
        <div className="bg-[#0D131F] border border-[#233047] rounded-lg p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5 text-xs">
            <span className="text-slate-300 font-medium">
              Live 8-bit <code className="font-mono text-sky-400">bit_buffer</code> Register (MSB-First)
            </span>
            <span className="font-mono text-slate-300">
              {hexReg} · {bitCount}/8 bits filled
              {activeEvent?.type === 'BIT_PUSH' && activeEvent.label
                ? ` · encoding ${activeEvent.label}`
                : ''}
            </span>
          </div>

          <div className="grid grid-cols-8 gap-2">
            {[7, 6, 5, 4, 3, 2, 1, 0].map((bitPos) => {
              const filled = bitPos < bitCount;
              const bitVal = filled ? (bitBuffer >> bitPos) & 1 : null;
              const isIncoming = activeEvent?.type === 'BIT_PUSH' && bitPos === 0 && bitCount > 0;
              const isFlushed = activeEvent?.type === 'BIT_FLUSH';

              let cellCls = 'border-[#233047] bg-[#0B0F17] text-slate-600';
              if (isFlushed) {
                cellCls = 'border-emerald-500/60 bg-emerald-500/12 text-emerald-300';
              } else if (isIncoming) {
                cellCls = 'border-amber-400 bg-amber-500/20 text-amber-300';
              } else if (filled) {
                cellCls = 'border-sky-500/60 bg-sky-500/12 text-sky-300';
              }

              return (
                <div
                  key={bitPos}
                  className={`border rounded-lg py-2 flex flex-col items-center justify-center font-mono transition-colors ${cellCls}`}
                >
                  <span className="text-base font-bold leading-none">
                    {bitVal !== null ? bitVal : '·'}
                  </span>
                  <span className="text-[10px] text-slate-400 mt-1">b{bitPos}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Section Color Legend */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-300">
          {(Object.keys(SECTION_STYLES) as HexSection[]).map((sec) => {
            const hasSec = hexBytes.some((b) => b.section === sec);
            if (!hasSec) return null;
            return (
              <span key={sec} className="inline-flex items-center gap-1.5">
                <span className={`w-2.5 h-2.5 rounded-sm ${SECTION_STYLES[sec].dot}`} />
                {SECTION_STYLES[sec].label}
              </span>
            );
          })}
        </div>

        {/* Hex Dump Table */}
        <div className="bg-[#0B0F17] border border-[#233047] rounded-lg p-3 max-h-64 overflow-y-auto font-mono text-xs">
          {rows.length === 0 ? (
            <div className="text-slate-400 py-8 text-center">No hex bytes recorded yet.</div>
          ) : (
            <div className="space-y-1">
              {rows.map((row) => {
                const startOffset = row[0].offset;
                return (
                  <div key={startOffset} className="flex items-center gap-3">
                    <span className="text-slate-500 w-14 shrink-0 select-none">
                      0x{startOffset.toString(16).toUpperCase().padStart(4, '0')}
                    </span>
                    <div className="flex flex-wrap gap-1 flex-1">
                      {row.map((hb) => {
                        const hex = hb.value.toString(16).toUpperCase().padStart(2, '0');
                        const isCursor = hb.offset === activeHexCursor;
                        const isSelected = selectedByte?.offset === hb.offset;
                        return (
                          <button
                            key={hb.offset}
                            type="button"
                            onClick={() => {
                              setSelectedByte(hb);
                              if (hb.section === 'payload' && onJumpToOffset) {
                                onJumpToOffset(hb.offset);
                              }
                            }}
                            title={`Offset ${hb.offset}: 0x${hex} — ${hb.note}`}
                            className={`px-1.5 py-0.5 rounded border text-[11px] font-semibold transition-transform ${
                              SECTION_STYLES[hb.section].bg
                            } ${
                              isCursor || isSelected
                                ? 'ring-2 ring-white scale-105'
                                : 'hover:brightness-125'
                            }`}
                          >
                            {hex}
                          </button>
                        );
                      })}
                    </div>
                    <span className="hidden lg:block text-slate-500 w-36 shrink-0 truncate text-right">
                      {row
                        .map((hb) =>
                          hb.value >= 32 && hb.value <= 126 ? String.fromCharCode(hb.value) : '.'
                        )
                        .join('')}
                    </span>
                  </div>
                );
              })}
              {hexBytes.length > visibleLimit && (
                <div className="pt-2 text-slate-400">
                  Showing first {visibleLimit} of {hexBytes.length} bytes (download .huf for complete binary).
                </div>
              )}
            </div>
          )}
        </div>

        {/* Selected Byte Detail Bar */}
        {selectedByte && (
          <div className="text-xs font-mono text-slate-300 bg-[#0D131F] border border-[#233047] rounded-lg px-3 py-2 flex flex-wrap items-center justify-between gap-2">
            <span>
              Offset {selectedByte.offset} (0x
              {selectedByte.offset.toString(16).toUpperCase().padStart(2, '0')}) · Byte{' '}
              <span className="text-sky-400">
                0x{selectedByte.value.toString(16).toUpperCase().padStart(2, '0')}
              </span>{' '}
              ({selectedByte.value.toString(2).padStart(8, '0')})
            </span>
            <span className="text-slate-400">{selectedByte.note}</span>
          </div>
        )}
      </div>
    </div>
  );
};
