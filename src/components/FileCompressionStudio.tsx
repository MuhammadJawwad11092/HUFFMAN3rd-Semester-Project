import React, { useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileArchive,
  FileUp,
  RotateCcw,
  AlertTriangle,
  Eye,
} from 'lucide-react';
import {
  compressBytes,
  CompressionModeId,
  CompressionOutput,
  ContainerFormat,
} from '../engine/Compression';
import { formatCrc32Hex } from '../engine/CRC32';
import { decompressBytes, DecompressionOutput } from '../engine/Decompression';

interface FileCompressionStudioProps {
  onLoadIntoXray: (text: string, mode: CompressionModeId, container: ContainerFormat) => void;
}

function triggerDownload(bytes: Uint8Array, fileName: string): void {
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

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export const FileCompressionStudio: React.FC<FileCompressionStudioProps> = ({
  onLoadIntoXray,
}) => {
  // Compress panel state
  const compInputRef = useRef<HTMLInputElement>(null);
  const [compFileName, setCompFileName] = useState<string>('');
  const [compRawBytes, setCompRawBytes] = useState<Uint8Array | null>(null);
  const [compContainer, setCompContainer] = useState<ContainerFormat>('huf2');
  const [compMode, setCompMode] = useState<CompressionModeId | 'auto'>('auto');
  const [smartBypass, setSmartBypass] = useState<boolean>(true);
  const [compResult, setCompResult] = useState<CompressionOutput | null>(null);
  const [compRoundtripOk, setCompRoundtripOk] = useState<boolean | null>(null);

  // Decompress panel state
  const decInputRef = useRef<HTMLInputElement>(null);
  const [decFileName, setDecFileName] = useState<string>('');
  const [decRawBytes, setDecRawBytes] = useState<Uint8Array | null>(null);
  const [decResult, setDecResult] = useState<DecompressionOutput | null>(null);

  const runCompress = (
    raw: Uint8Array,
    fileName: string,
    container: ContainerFormat,
    mode: CompressionModeId | 'auto',
    bypass: boolean
  ) => {
    const out = compressBytes(raw, {
      container,
      mode,
      allowSmartBypass: bypass,
      trace: false,
    });
    const verify = decompressBytes(out.data);
    setCompFileName(fileName);
    setCompRawBytes(raw);
    setCompResult(out);
    setCompRoundtripOk(verify.success && bytesEqual(verify.data, raw));
  };

  const handleCompressUpload = async (file: File | undefined) => {
    if (!file) return;
    const buf = new Uint8Array(await file.arrayBuffer());
    runCompress(buf, file.name, compContainer, compMode, smartBypass);
  };

  const recompressWithSettings = (
    nextContainer: ContainerFormat,
    nextMode: CompressionModeId | 'auto',
    nextBypass: boolean
  ) => {
    setCompContainer(nextContainer);
    setCompMode(nextMode);
    setSmartBypass(nextBypass);
    if (compRawBytes && compFileName) {
      runCompress(compRawBytes, compFileName, nextContainer, nextMode, nextBypass);
    }
  };

  const handleDecompressUpload = async (file: File | undefined) => {
    if (!file) return;
    const buf = new Uint8Array(await file.arrayBuffer());
    const out = decompressBytes(buf);
    setDecFileName(file.name);
    setDecRawBytes(buf);
    setDecResult(out);
  };

  const restoredFileName = decFileName.toLowerCase().endsWith('.huf')
    ? decFileName.slice(0, -4) || 'restored.bin'
    : `${decFileName || 'output'}.restored`;

  const previewText = (() => {
    if (!decResult?.success || decResult.data.length === 0) return '';
    try {
      const slice = decResult.data.subarray(0, 600);
      return new TextDecoder('utf-8', { fatal: false }).decode(slice);
    } catch {
      return '';
    }
  })();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
      {/* COMPRESS CARD */}
      <div className="bg-[#111827] border border-[#233047] rounded-xl p-5 flex flex-col justify-between">
        <div>
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Compress File to .huf
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Upload any text or binary file to encode with Min-Heap Huffman coding and verify lossless round-trip recovery.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                const sample = new TextEncoder().encode('AAAABBBBCCCCDDDDEEEEE');
                runCompress(sample, 'input.txt', compContainer, compMode, smartBypass);
              }}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[#233047] bg-[#0D131F] text-slate-300 hover:border-sky-500/60 hover:text-sky-300 transition-colors whitespace-nowrap shrink-0"
            >
              Use input.txt
            </button>
          </div>

          {/* Options row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">
                Container Format
              </label>
              <select
                value={compContainer}
                onChange={(e) =>
                  recompressWithSettings(
                    e.target.value as ContainerFormat,
                    compMode,
                    smartBypass
                  )
                }
                className="w-full bg-[#0B0F17] border border-[#233047] rounded-lg px-2.5 py-2 text-xs text-slate-100 focus:outline-none focus:border-sky-500"
              >
                <option value="huf2">HUF2 (CRC32 + Mode Flag)</option>
                <option value="huf1">Classic .huf v1 (C++ Team)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">
                Coding Mode
              </label>
              <select
                value={compContainer === 'huf1' ? 1 : compMode}
                disabled={compContainer === 'huf1'}
                onChange={(e) => {
                  const val = e.target.value;
                  const parsed = val === 'auto' ? 'auto' : (Number(val) as CompressionModeId);
                  recompressWithSettings(compContainer, parsed, smartBypass);
                }}
                className="w-full bg-[#0B0F17] border border-[#233047] rounded-lg px-2.5 py-2 text-xs text-slate-100 focus:outline-none focus:border-sky-500 disabled:opacity-50"
              >
                <option value="auto">Auto-Best (Smallest)</option>
                <option value="2">Canonical Huffman (Bit-Lengths)</option>
                <option value="1">Static Huffman (Preorder Tree)</option>
                <option value="0">Raw Bypass (Mode 0)</option>
              </select>
            </div>

            <div className="flex items-end">
              <label className="flex items-center gap-2 text-xs text-slate-300 bg-[#0B0F17] border border-[#233047] rounded-lg px-3 py-2 w-full cursor-pointer">
                <input
                  type="checkbox"
                  checked={smartBypass}
                  disabled={compContainer === 'huf1'}
                  onChange={(e) =>
                    recompressWithSettings(compContainer, compMode, e.target.checked)
                  }
                  className="accent-sky-500"
                />
                <span>Smart Bypass</span>
              </label>
            </div>
          </div>

          {/* Dropzone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              handleCompressUpload(e.dataTransfer.files?.[0]);
            }}
            onClick={() => compInputRef.current?.click()}
            className="border border-dashed border-[#334666] hover:border-sky-500/70 bg-[#0B0F17] rounded-xl p-6 text-center cursor-pointer transition-colors"
          >
            <input
              ref={compInputRef}
              type="file"
              className="hidden"
              onChange={(e) => handleCompressUpload(e.target.files?.[0])}
            />
            <FileUp className="w-7 h-7 text-sky-400 mx-auto mb-2" />
            <p className="text-sm font-medium text-slate-200">
              {compFileName ? `Loaded: ${compFileName}` : 'Drop a file here or click to browse'}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Supports .txt, .json, .log, .csv, .fasta, .png, or any binary file
            </p>
          </div>

          {/* Compression Results */}
          {compResult && (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="bg-[#0D131F] border border-[#233047] rounded-lg p-2.5">
                  <div className="text-[11px] text-slate-400">Original</div>
                  <div className="text-sm font-mono font-semibold text-slate-100 mt-0.5">
                    {formatBytes(compResult.originalSize)}
                  </div>
                </div>
                <div className="bg-[#0D131F] border border-[#233047] rounded-lg p-2.5">
                  <div className="text-[11px] text-slate-400">Compressed (.huf)</div>
                  <div className="text-sm font-mono font-semibold text-sky-400 mt-0.5">
                    {formatBytes(compResult.compressedSize)}
                  </div>
                </div>
                <div className="bg-[#0D131F] border border-[#233047] rounded-lg p-2.5">
                  <div className="text-[11px] text-slate-400">Size Ratio</div>
                  <div className="text-sm font-mono font-semibold text-emerald-400 mt-0.5">
                    {compResult.originalSize === 0
                      ? '100.0%'
                      : `${((100 * compResult.compressedSize) / compResult.originalSize).toFixed(1)}%`}
                  </div>
                </div>
                <div className="bg-[#0D131F] border border-[#233047] rounded-lg p-2.5">
                  <div className="text-[11px] text-slate-400">CRC32</div>
                  <div className="text-xs font-mono font-semibold text-amber-300 mt-1">
                    {formatCrc32Hex(compResult.crc32)}
                  </div>
                </div>
              </div>

              <div className="text-xs text-slate-300 flex flex-wrap items-center justify-between gap-2 bg-[#0D131F] border border-[#233047] rounded-lg px-3 py-2">
                <span>
                  {compResult.modeName}
                  {compResult.smartBypassTriggered ? ' · Smart Bypass triggered' : ''} ·{' '}
                  {compResult.headerBytes}B header + {compResult.treeHeaderBytes}B tree +{' '}
                  {compResult.payloadBytes}B payload · {compResult.durationMs.toFixed(2)} ms
                </span>
                <span
                  className={`inline-flex items-center gap-1 font-medium ${
                    compRoundtripOk ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {compRoundtripOk ? 'Lossless verified' : 'Mismatch'}
                </span>
              </div>
            </div>
          )}
        </div>

        {compResult && (
          <div className="mt-4 pt-4 border-t border-[#233047] flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => triggerDownload(compResult.data, `${compFileName || 'output'}.huf`)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors"
            >
              <Download className="w-4 h-4" />
              Download {compFileName || 'output'}.huf
            </button>

            <button
              type="button"
              onClick={() => {
                if (!decRawBytes) {
                  setDecFileName(`${compFileName || 'output'}.huf`);
                  setDecRawBytes(compResult.data);
                  setDecResult(decompressBytes(compResult.data));
                } else {
                  setDecFileName(`${compFileName || 'output'}.huf`);
                  setDecRawBytes(compResult.data);
                  setDecResult(decompressBytes(compResult.data));
                }
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-[#233047] bg-[#0D131F] text-slate-200 hover:border-sky-500/60 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Test in Decompressor
            </button>

            {compRawBytes && compRawBytes.length <= 2048 && (
              <button
                type="button"
                onClick={() => {
                  const text = new TextDecoder('utf-8', { fatal: false }).decode(compRawBytes);
                  onLoadIntoXray(text, compResult.modeUsed, compResult.container);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-[#233047] bg-[#0D131F] text-slate-200 hover:border-sky-500/60 transition-colors"
              >
                <Eye className="w-3.5 h-3.5" />
                Open in X-Ray
              </button>
            )}
          </div>
        )}
      </div>

      {/* DECOMPRESS CARD */}
      <div className="bg-[#111827] border border-[#233047] rounded-xl p-5 flex flex-col justify-between">
        <div>
          <div className="mb-4">
            <h2 className="text-base font-semibold text-slate-100">
              Decompress .huf Archive
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Auto-detects both <code className="font-mono text-sky-400">HUF2</code> archives and classic C++{' '}
              <code className="font-mono text-sky-400">.huf</code> v1 binaries created by your original executable.
            </p>
          </div>

          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              handleDecompressUpload(e.dataTransfer.files?.[0]);
            }}
            onClick={() => decInputRef.current?.click()}
            className="border border-dashed border-[#334666] hover:border-emerald-500/70 bg-[#0B0F17] rounded-xl p-6 text-center cursor-pointer transition-colors"
          >
            <input
              ref={decInputRef}
              type="file"
              accept=".huf,*/*"
              className="hidden"
              onChange={(e) => handleDecompressUpload(e.target.files?.[0])}
            />
            <FileArchive className="w-7 h-7 text-emerald-400 mx-auto mb-2" />
            <p className="text-sm font-medium text-slate-200">
              {decFileName ? `Loaded: ${decFileName}` : 'Drop a .huf file here or click to browse'}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Reconstructs tree from preorder or canonical bit-lengths &amp; decodes MSB-first bits
            </p>
          </div>

          {decResult && (
            <div className="mt-4 space-y-3">
              {decResult.success ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div className="bg-[#0D131F] border border-[#233047] rounded-lg p-2.5">
                      <div className="text-[11px] text-slate-400">Container</div>
                      <div className="text-sm font-mono font-semibold text-slate-100 mt-0.5 uppercase">
                        {decResult.containerDetected}
                      </div>
                    </div>
                    <div className="bg-[#0D131F] border border-[#233047] rounded-lg p-2.5">
                      <div className="text-[11px] text-slate-400">Restored Size</div>
                      <div className="text-sm font-mono font-semibold text-emerald-400 mt-0.5">
                        {formatBytes(decResult.originalSize)}
                      </div>
                    </div>
                    <div className="bg-[#0D131F] border border-[#233047] rounded-lg p-2.5">
                      <div className="text-[11px] text-slate-400">CRC32</div>
                      <div className="text-xs font-mono font-semibold text-amber-300 mt-1">
                        {formatCrc32Hex(decResult.computedCrc32)}
                      </div>
                    </div>
                    <div className="bg-[#0D131F] border border-[#233047] rounded-lg p-2.5">
                      <div className="text-[11px] text-slate-400">Integrity</div>
                      <div className="text-xs font-semibold text-emerald-400 mt-1">
                        {decResult.crcVerified === true
                          ? 'CRC32 PASS'
                          : decResult.crcVerified === null
                          ? 'SIZE VERIFIED'
                          : 'CRC32 FAIL'}
                      </div>
                    </div>
                  </div>

                  <div className="text-xs text-slate-300 bg-[#0D131F] border border-[#233047] rounded-lg px-3 py-2">
                    Detected {decResult.modeName} · Decoded in {decResult.durationMs.toFixed(2)} ms
                  </div>

                  {previewText && (
                    <div className="bg-[#0B0F17] border border-[#233047] rounded-lg p-3">
                      <div className="text-[11px] text-slate-400 mb-1">
                        Restored Content Preview (first {Math.min(600, decResult.data.length)} bytes)
                      </div>
                      <pre className="text-xs font-mono text-slate-200 whitespace-pre-wrap break-all max-h-36 overflow-y-auto">
                        {previewText}
                      </pre>
                    </div>
                  )}
                </>
              ) : (
                <div className="bg-rose-500/10 border border-rose-500/40 rounded-lg p-3.5 flex items-start gap-2.5 text-xs text-rose-200">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-rose-300">Decompression Failed</p>
                    <p className="mt-0.5">{decResult.errorMessage}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {decResult?.success && (
          <div className="mt-4 pt-4 border-t border-[#233047]">
            <button
              type="button"
              onClick={() => triggerDownload(decResult.data, restoredFileName)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
            >
              <Download className="w-4 h-4" />
              Download {restoredFileName}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
