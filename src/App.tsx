import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { BenchmarkPreset, XRAY_PRESETS } from './engine/Benchmark';
import {
  compressBytes,
  CompressionModeId,
  CompressionOutput,
  ContainerFormat,
} from './engine/Compression';
import { formatCrc32Hex } from './engine/CRC32';
import { decompressBytes, DecompressionOutput } from './engine/Decompression';
import { formatByteLabel, HeapSlotSnapshot, TraceEvent } from './engine/TraceLogger';
import { MinHeapVisualizer } from './components/MinHeapVisualizer';
import { HuffmanTreeVisualizer } from './components/HuffmanTreeVisualizer';
import { BitBufferHexInspector } from './components/BitBufferHexInspector';
import { FileCompressionStudio } from './components/FileCompressionStudio';
import { BenchmarkView } from './components/BenchmarkView';

type ActiveView = 'xray' | 'files' | 'benchmark';

interface ComputedFrame {
  heap: HeapSlotSnapshot[];
  mergedIds: Set<number>;
  bitBuffer: number;
  bitCount: number;
  flushedCount: number;
  decodedChars: string[];
}

interface XrayRunState {
  comp: CompressionOutput;
  dec: DecompressionOutput;
  roundtripMatch: boolean;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function downloadUint8Array(bytes: Uint8Array, fileName: string): void {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const blob = new Blob([copy], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function App() {
  const [activeView, setActiveView] = useState<ActiveView>('xray');

  // X-Ray inputs
  const [inputText, setInputText] = useState<string>(XRAY_PRESETS.team_default.sampleText);
  const [selectedPreset, setSelectedPreset] = useState<BenchmarkPreset | 'custom'>('team_default');
  const [mode, setMode] = useState<CompressionModeId>(1);
  const [container, setContainer] = useState<ContainerFormat>('huf2');

  // X-Ray execution state
  const [runState, setRunState] = useState<XrayRunState>(() => {
    const raw = new TextEncoder().encode(XRAY_PRESETS.team_default.sampleText);
    const comp = compressBytes(raw, {
      container: 'huf2',
      mode: 1,
      allowSmartBypass: false,
      trace: true,
      maxTraceEvents: 3500,
    });
    const dec = decompressBytes(comp.data, { logger: comp.logger });
    return { comp, dec, roundtripMatch: dec.success && bytesEqual(dec.data, raw) };
  });

  const [stepIdx, setStepIdx] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [speedMs, setSpeedMs] = useState<number>(220);
  const [highlightChar, setHighlightChar] = useState<number | null>(null);

  const executeTrace = (
    text: string,
    chosenMode: CompressionModeId,
    chosenContainer: ContainerFormat
  ) => {
    setIsPlaying(false);
    setHighlightChar(null);
    const effectiveMode: CompressionModeId = chosenContainer === 'huf1' ? 1 : chosenMode;
    const raw = new TextEncoder().encode(text);
    const comp = compressBytes(raw, {
      container: chosenContainer,
      mode: effectiveMode,
      allowSmartBypass: false,
      trace: true,
      maxTraceEvents: 3500,
    });
    const dec = decompressBytes(comp.data, { logger: comp.logger });
    setRunState({
      comp,
      dec,
      roundtripMatch: dec.success && bytesEqual(dec.data, raw),
    });
    setStepIdx(0);
  };

  const events = runState.comp.logger.events;

  // Precompute cumulative frame snapshots for instant O(1) stepping & scrubbing
  const frames = useMemo<ComputedFrame[]>(() => {
    const out: ComputedFrame[] = [];
    let curHeap: HeapSlotSnapshot[] = [];
    const mergedIds = new Set<number>();
    let curBitBuffer = 0;
    let curBitCount = 0;
    let flushedCount = runState.comp.headerBytes + runState.comp.treeHeaderBytes;
    const decodedChars: string[] = [];

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (
        (ev.type === 'HEAP_INSERT' || ev.type === 'HEAP_SWAP') &&
        ev.heapSnapshot
      ) {
        curHeap = ev.heapSnapshot;
      } else if (ev.type === 'EXTRACT_MERGE') {
        if (ev.heapSnapshot) curHeap = ev.heapSnapshot;
        if (ev.parentId !== undefined) mergedIds.add(ev.parentId);
      } else if (ev.type === 'BIT_PUSH') {
        curBitBuffer = ev.bitBuffer ?? 0;
        curBitCount = ev.bitCount ?? 0;
      } else if (ev.type === 'BIT_FLUSH') {
        curBitBuffer = 0;
        curBitCount = 0;
        flushedCount = ev.hexOffset !== undefined ? ev.hexOffset + 1 : flushedCount + 1;
      } else if (ev.type === 'DECODE_CHAR' && ev.character !== undefined) {
        decodedChars.push(formatByteLabel(ev.character));
      }

      // When entering codes/packing/decode after heap construction, heap holds only the single root
      if (ev.phase !== 'heap' && curHeap.length > 1 && runState.comp.root) {
        curHeap = [
          {
            id: runState.comp.root.id,
            character: runState.comp.root.character,
            label: runState.comp.root.isLeaf()
              ? formatByteLabel(runState.comp.root.character)
              : `Root #${runState.comp.root.id}`,
            freq: runState.comp.root.freq,
            isLeaf: runState.comp.root.isLeaf(),
          },
        ];
      }

      out.push({
        heap: curHeap,
        mergedIds: new Set(mergedIds),
        bitBuffer: curBitBuffer,
        bitCount: curBitCount,
        flushedCount,
        decodedChars: decodedChars.slice(-36),
      });
    }
    return out;
  }, [events, runState.comp.headerBytes, runState.comp.treeHeaderBytes, runState.comp.root]);

  const activeEvent: TraceEvent | null = events[stepIdx] ?? null;
  const activeFrame: ComputedFrame = frames[stepIdx] ?? {
    heap: [],
    mergedIds: new Set<number>(),
    bitBuffer: 0,
    bitCount: 0,
    flushedCount: 0,
    decodedChars: [],
  };

  // Code lookup map for interactive tree path highlighting
  const codeMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of runState.comp.logger.codes) {
      map.set(c.character, c.code);
    }
    return map;
  }, [runState.comp.logger.codes]);

  // Phase jump indices
  const phaseFirstIndex = useMemo(() => {
    const findFirst = (phase: TraceEvent['phase']) =>
      events.findIndex((e) => e.phase === phase);
    return {
      heap: findFirst('heap'),
      codes: findFirst('codes'),
      packing: findFirst('packing'),
      decode: findFirst('decode'),
    };
  }, [events]);

  // Playback timer
  useEffect(() => {
    if (!isPlaying) return;
    if (stepIdx >= events.length - 1) {
      setIsPlaying(false);
      return;
    }
    const id = window.setTimeout(() => {
      setStepIdx((prev) => Math.min(prev + 1, events.length - 1));
    }, speedMs);
    return () => window.clearTimeout(id);
  }, [isPlaying, stepIdx, events.length, speedMs]);

  const handleJumpToHexOffset = (offset: number) => {
    const idx = events.findIndex((e) => e.type === 'BIT_FLUSH' && e.hexOffset === offset);
    if (idx !== -1) {
      setIsPlaying(false);
      setStepIdx(idx);
    }
  };

  const ratioPct =
    runState.comp.originalSize === 0
      ? 100
      : (100 * runState.comp.compressedSize) / runState.comp.originalSize;

  return (
    <div className="min-h-screen bg-[#0B0F17] text-[#E6EDF7] flex flex-col">
      {/* Top Bar Contract: [Brand title, one line] — [nav links] — [1 primary action] */}
      <header className="sticky top-0 z-30 bg-[#0D131F]/95 backdrop-blur border-b border-[#233047]">
        <div className="max-w-[1440px] mx-auto px-6 py-3.5 flex items-center justify-between gap-8">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveView('xray');
            }}
            className="text-base font-display font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0"
          >
            Huffman X-Ray
          </a>

          <nav className="flex items-center gap-6 text-sm font-medium">
            <button
              type="button"
              onClick={() => setActiveView('xray')}
              className={`whitespace-nowrap shrink-0 pb-0.5 transition-colors border-b-2 ${
                activeView === 'xray'
                  ? 'text-sky-400 border-sky-400'
                  : 'text-slate-400 border-transparent hover:text-slate-100'
              }`}
            >
              X-Ray Visualizer
            </button>
            <button
              type="button"
              onClick={() => setActiveView('files')}
              className={`whitespace-nowrap shrink-0 pb-0.5 transition-colors border-b-2 ${
                activeView === 'files'
                  ? 'text-sky-400 border-sky-400'
                  : 'text-slate-400 border-transparent hover:text-slate-100'
              }`}
            >
              File Studio
            </button>
            <button
              type="button"
              onClick={() => setActiveView('benchmark')}
              className={`whitespace-nowrap shrink-0 pb-0.5 transition-colors border-b-2 ${
                activeView === 'benchmark'
                  ? 'text-sky-400 border-sky-400'
                  : 'text-slate-400 border-transparent hover:text-slate-100'
              }`}
            >
              Benchmark
            </button>
          </nav>

          <div className="shrink-0">
            <button
              type="button"
              onClick={() => {
                setActiveView('xray');
                executeTrace(inputText, mode, container);
              }}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors whitespace-nowrap shrink-0"
            >
              Run X-Ray Trace
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1440px] w-full mx-auto px-6 py-6 flex-1 space-y-5">
        {activeView === 'xray' && (
          <>
            {/* Input & Algorithm Configuration Bar */}
            <section className="bg-[#111827] border border-[#233047] rounded-xl p-4">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
                <div className="lg:col-span-5">
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    Input Data Stream
                  </label>
                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => {
                      setSelectedPreset('custom');
                      setInputText(e.target.value);
                    }}
                    placeholder="Enter text to compress and trace..."
                    className="w-full bg-[#0B0F17] border border-[#233047] rounded-lg px-3 py-2 text-sm font-mono text-slate-100 focus:outline-none focus:border-sky-500"
                  />
                </div>

                <div className="lg:col-span-3">
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    Sample Preset
                  </label>
                  <select
                    value={selectedPreset}
                    onChange={(e) => {
                      const val = e.target.value as BenchmarkPreset | 'custom';
                      setSelectedPreset(val);
                      if (val !== 'custom') {
                        const nextText = XRAY_PRESETS[val].sampleText;
                        setInputText(nextText);
                        executeTrace(nextText, mode, container);
                      }
                    }}
                    className="w-full bg-[#0B0F17] border border-[#233047] rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500"
                  >
                    {(Object.keys(XRAY_PRESETS) as BenchmarkPreset[]).map((k) => (
                      <option key={k} value={k}>
                        {XRAY_PRESETS[k].label}
                      </option>
                    ))}
                    <option value="custom">Custom Input</option>
                  </select>
                </div>

                <div className="lg:col-span-2">
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    Tree Mode
                  </label>
                  <select
                    value={container === 'huf1' ? 1 : mode}
                    disabled={container === 'huf1'}
                    onChange={(e) => {
                      const m = Number(e.target.value) as CompressionModeId;
                      setMode(m);
                      executeTrace(inputText, m, container);
                    }}
                    className="w-full bg-[#0B0F17] border border-[#233047] rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500 disabled:opacity-50"
                  >
                    <option value={1}>Static Huffman</option>
                    <option value={2}>Canonical Huffman</option>
                  </select>
                </div>

                <div className="lg:col-span-2">
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    .huf Format
                  </label>
                  <select
                    value={container}
                    onChange={(e) => {
                      const c = e.target.value as ContainerFormat;
                      setContainer(c);
                      executeTrace(inputText, mode, c);
                    }}
                    className="w-full bg-[#0B0F17] border border-[#233047] rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500"
                  >
                    <option value="huf2">HUF2 (CRC32 + Mode)</option>
                    <option value="huf1">Classic .huf v1 (C++)</option>
                  </select>
                </div>
              </div>
            </section>

            {/* KPI Summary Row */}
            <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="bg-[#111827] border border-[#233047] rounded-xl px-4 py-3">
                <div className="text-xs text-slate-400">Original Input</div>
                <div className="text-lg font-mono font-semibold text-slate-100 mt-0.5">
                  {runState.comp.originalSize} B
                </div>
              </div>
              <div className="bg-[#111827] border border-[#233047] rounded-xl px-4 py-3">
                <div className="text-xs text-slate-400">Encoded .huf File</div>
                <div className="text-lg font-mono font-semibold text-sky-400 mt-0.5">
                  {runState.comp.compressedSize} B
                </div>
              </div>
              <div className="bg-[#111827] border border-[#233047] rounded-xl px-4 py-3">
                <div className="text-xs text-slate-400">Header / Tree / Data</div>
                <div className="text-sm font-mono font-semibold text-slate-200 mt-1.5">
                  {runState.comp.headerBytes}B / {runState.comp.treeHeaderBytes}B /{' '}
                  {runState.comp.payloadBytes}B
                </div>
              </div>
              <div className="bg-[#111827] border border-[#233047] rounded-xl px-4 py-3">
                <div className="text-xs text-slate-400">Compression Ratio</div>
                <div
                  className={`text-lg font-mono font-semibold mt-0.5 ${
                    ratioPct < 100 ? 'text-emerald-400' : 'text-amber-400'
                  }`}
                >
                  {ratioPct.toFixed(1)}%
                </div>
              </div>
              <div className="bg-[#111827] border border-[#233047] rounded-xl px-4 py-3">
                <div className="text-xs text-slate-400">Lossless Verification</div>
                <div className="mt-1 flex items-center gap-1.5 text-sm font-mono font-semibold">
                  {runState.roundtripMatch ? (
                    <span className="text-emerald-400 inline-flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4" />
                      {formatCrc32Hex(runState.comp.crc32)}
                    </span>
                  ) : (
                    <span className="text-rose-400 inline-flex items-center gap-1">
                      <AlertTriangle className="w-4 h-4" />
                      Mismatch
                    </span>
                  )}
                </div>
              </div>
            </section>

            {/* Time-Travel Stepper & Phase Navigation */}
            <section className="bg-[#111827] border border-[#233047] rounded-xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setIsPlaying(false);
                      setStepIdx(0);
                    }}
                    className="p-2 rounded-lg border border-[#233047] bg-[#0D131F] text-slate-300 hover:border-sky-500/60 hover:text-sky-300 transition-colors"
                    title="Jump to start"
                  >
                    <SkipBack className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsPlaying(false);
                      setStepIdx((i) => Math.max(0, i - 1));
                    }}
                    className="p-2 rounded-lg border border-[#233047] bg-[#0D131F] text-slate-300 hover:border-sky-500/60 hover:text-sky-300 transition-colors"
                    title="Step backward"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (events.length === 0) return;
                      if (!isPlaying && stepIdx >= events.length - 1) setStepIdx(0);
                      setIsPlaying((p) => !p);
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition-colors"
                  >
                    {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    {isPlaying ? 'Pause' : 'Play'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsPlaying(false);
                      setStepIdx((i) => Math.min(events.length - 1, i + 1));
                    }}
                    className="p-2 rounded-lg border border-[#233047] bg-[#0D131F] text-slate-300 hover:border-sky-500/60 hover:text-sky-300 transition-colors"
                    title="Step forward"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsPlaying(false);
                      setStepIdx(Math.max(0, events.length - 1));
                    }}
                    className="p-2 rounded-lg border border-[#233047] bg-[#0D131F] text-slate-300 hover:border-sky-500/60 hover:text-sky-300 transition-colors"
                    title="Jump to end"
                  >
                    <SkipForward className="w-4 h-4" />
                  </button>
                </div>

                {/* Scrubber */}
                <div className="flex-1 min-w-[200px] flex items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, events.length - 1)}
                    value={stepIdx}
                    onChange={(e) => {
                      setIsPlaying(false);
                      setStepIdx(Number(e.target.value));
                    }}
                    className="w-full accent-sky-500 cursor-pointer"
                  />
                  <span className="text-xs font-mono text-slate-300 whitespace-nowrap shrink-0">
                    {events.length === 0 ? '0 / 0' : `${stepIdx + 1} / ${events.length}`}
                  </span>
                </div>

                {/* Phase quick jumps + speed */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {(
                    [
                      ['heap', '1. Min-Heap'],
                      ['codes', '2. Codes'],
                      ['packing', '3. Bit Buffer'],
                      ['decode', '4. Decode'],
                    ] as const
                  ).map(([pKey, pLabel]) => {
                    const idx = phaseFirstIndex[pKey];
                    const isActive = activeEvent?.phase === pKey;
                    return (
                      <button
                        key={pKey}
                        type="button"
                        disabled={idx === -1}
                        onClick={() => {
                          if (idx !== -1) {
                            setIsPlaying(false);
                            setStepIdx(idx);
                          }
                        }}
                        className={`px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors whitespace-nowrap shrink-0 disabled:opacity-40 ${
                          isActive
                            ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                            : 'border-[#233047] bg-[#0D131F] text-slate-300 hover:text-slate-100'
                        }`}
                      >
                        {pLabel}
                      </button>
                    );
                  })}

                  <select
                    value={speedMs}
                    onChange={(e) => setSpeedMs(Number(e.target.value))}
                    className="bg-[#0B0F17] border border-[#233047] rounded-md px-2 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-sky-500"
                    title="Playback speed"
                  >
                    <option value={500}>0.5x</option>
                    <option value={220}>1x</option>
                    <option value={90}>2.5x</option>
                    <option value={25}>8x</option>
                  </select>
                </div>
              </div>

              {/* Active Step Explanation Banner */}
              <div className="bg-[#0B0F17] border border-[#233047] rounded-lg px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-mono text-slate-200">
                  {activeEvent
                    ? activeEvent.detail
                    : 'No events recorded (input is empty).'}
                </span>
                <span className="font-mono text-slate-400">
                  {activeEvent ? `${activeEvent.phase.toUpperCase()} · ${activeEvent.type}` : 'IDLE'}
                </span>
              </div>
            </section>

            {/* Dual Stage: Min-Heap Array + Interactive Binary Huffman Tree */}
            <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
              <div className="lg:col-span-5">
                <MinHeapVisualizer heap={activeFrame.heap} activeEvent={activeEvent} />
              </div>
              <div className="lg:col-span-7">
                <HuffmanTreeVisualizer
                  treeNodes={runState.comp.logger.treeNodes}
                  mergedNodeIds={activeFrame.mergedIds}
                  activeEvent={activeEvent}
                  highlightChar={highlightChar}
                  onSelectChar={setHighlightChar}
                  codes={codeMap}
                />
              </div>
            </section>

            {/* Bottom Stage: Live Bit-Buffer & Hex Inspector + Prefix Code Table */}
            <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
              <div className="lg:col-span-7">
                <BitBufferHexInspector
                  bitBuffer={activeFrame.bitBuffer}
                  bitCount={activeFrame.bitCount}
                  hexBytes={runState.comp.logger.hexBytes}
                  flushedCount={activeFrame.flushedCount}
                  activeEvent={activeEvent}
                  onJumpToOffset={handleJumpToHexOffset}
                  onDownloadHuf={() =>
                    downloadUint8Array(
                      runState.comp.data,
                      container === 'huf2' ? 'output_v2.huf' : 'output.huf'
                    )
                  }
                />
              </div>

              <div className="lg:col-span-5 bg-[#111827] border border-[#233047] rounded-xl overflow-hidden flex flex-col">
                <div className="flex items-center justify-between px-4 py-3 border-b border-[#233047]">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-100">
                      Prefix Code Table
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Click any symbol row to highlight its 0/1 path in the Huffman Tree
                    </p>
                  </div>
                  <span className="text-xs font-mono text-slate-400">
                    {runState.comp.logger.codes.length} symbols
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto max-h-80">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-[#233047] text-slate-400 bg-[#0D131F] sticky top-0">
                      <tr>
                        <th className="py-2 px-3 font-medium">Byte</th>
                        <th className="py-2 px-3 font-medium text-right">Freq</th>
                        <th className="py-2 px-3 font-medium">Static Code</th>
                        <th className="py-2 px-3 font-medium">Canonical</th>
                        <th className="py-2 px-3 font-medium text-right">Bits</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#233047]/60">
                      {[...runState.comp.logger.codes]
                        .sort((a, b) => a.bitLength - b.bitLength || a.character - b.character)
                        .map((row) => {
                          const isSelected = highlightChar === row.character;
                          return (
                            <tr
                              key={row.character}
                              onClick={() =>
                                setHighlightChar(isSelected ? null : row.character)
                              }
                              className={`cursor-pointer transition-colors ${
                                isSelected ? 'bg-sky-500/15' : 'hover:bg-[#151E2E]'
                              }`}
                            >
                              <td className="py-2 px-3 font-mono font-semibold text-sky-300">
                                {row.label}
                              </td>
                              <td className="py-2 px-3 font-mono text-right text-slate-300">
                                {row.freq}
                              </td>
                              <td className="py-2 px-3 font-mono text-emerald-300">
                                {runState.comp.codes[row.character] || row.code}
                              </td>
                              <td className="py-2 px-3 font-mono text-amber-300">
                                {runState.comp.canonicalCodes[row.character] || row.canonicalCode}
                              </td>
                              <td className="py-2 px-3 font-mono text-right text-slate-400">
                                {row.bitLength}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>

                {activeFrame.decodedChars.length > 0 && (
                  <div className="border-t border-[#233047] px-4 py-2.5 bg-[#0D131F]">
                    <div className="text-[11px] text-slate-400 mb-1">
                      Decoded Output Stream (recent symbols)
                    </div>
                    <div className="font-mono text-xs text-emerald-300 flex flex-wrap gap-1">
                      {activeFrame.decodedChars.map((ch, idx) => (
                        <span
                          key={idx}
                          className="px-1.5 py-0.5 bg-[#0B0F17] border border-[#233047] rounded"
                        >
                          {ch}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>
          </>
        )}

        {activeView === 'files' && (
          <FileCompressionStudio
            onLoadIntoXray={(text, chosenMode, chosenContainer) => {
              setInputText(text);
              setSelectedPreset('custom');
              setMode(chosenMode);
              setContainer(chosenContainer);
              setActiveView('xray');
              executeTrace(text, chosenMode, chosenContainer);
            }}
          />
        )}

        {activeView === 'benchmark' && (
          <BenchmarkView currentInputText={inputText} />
        )}
      </main>
    </div>
  );
}
