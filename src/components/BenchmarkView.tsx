import React, { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import {
  BenchmarkPreset,
  BenchmarkRow,
  generateBenchmarkDataset,
  runBenchmarkSuite,
} from '../engine/Benchmark';

interface BenchmarkViewProps {
  currentInputText: string;
}

export const BenchmarkView: React.FC<BenchmarkViewProps> = ({ currentInputText }) => {
  const [preset, setPreset] = useState<BenchmarkPreset | 'custom'>('logs');
  const [sizeKB, setSizeKB] = useState<number>(32);
  const [rows, setRows] = useState<BenchmarkRow[]>([]);
  const [datasetLabel, setDatasetLabel] = useState<string>('');

  const execute = (selectedPreset: BenchmarkPreset | 'custom', kb: number) => {
    let data: Uint8Array;
    let label = '';
    if (selectedPreset === 'custom') {
      data = new TextEncoder().encode(currentInputText);
      label = `Current X-Ray Input (${data.length} B)`;
    } else if (selectedPreset === 'team_default') {
      data = generateBenchmarkDataset('team_default');
      label = `input.txt Team Default (${data.length} B)`;
    } else {
      data = generateBenchmarkDataset(selectedPreset, kb * 1024);
      label = `${selectedPreset.toUpperCase()} (${kb} KB)`;
    }
    setDatasetLabel(label);
    setRows(runBenchmarkSuite(data));
  };

  useEffect(() => {
    execute(preset, sizeKB);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <div className="bg-[#111827] border border-[#233047] rounded-xl p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Benchmark Dataset
            </label>
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value as BenchmarkPreset | 'custom')}
              className="w-full bg-[#0B0F17] border border-[#233047] rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500"
            >
              <option value="logs">Server Error Logs (Structured)</option>
              <option value="dna">DNA FASTA Sequence (4-Base Alphabet)</option>
              <option value="json">IoT Sensor JSON Telemetry</option>
              <option value="english">English Technical Corpus</option>
              <option value="team_default">input.txt (21 B Team Default)</option>
              <option value="custom">Current X-Ray Editor Text</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Generated Volume
            </label>
            <select
              value={sizeKB}
              disabled={preset === 'custom' || preset === 'team_default'}
              onChange={(e) => setSizeKB(Number(e.target.value))}
              className="w-full bg-[#0B0F17] border border-[#233047] rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500 disabled:opacity-50"
            >
              <option value={8}>8 KB</option>
              <option value={32}>32 KB</option>
              <option value={64}>64 KB</option>
              <option value={128}>128 KB</option>
            </select>
          </div>

          <div className="flex md:justify-end">
            <button
              type="button"
              onClick={() => execute(preset, sizeKB)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors whitespace-nowrap shrink-0"
            >
              <Play className="w-4 h-4" />
              Run Comparison
            </button>
          </div>
        </div>
      </div>

      <div className="bg-[#111827] border border-[#233047] rounded-xl overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-[#233047]">
          <h3 className="text-sm font-semibold text-slate-100">
            Side-by-Side Compression Comparison
          </h3>
          <span className="text-xs font-mono text-slate-400">{datasetLabel}</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[#233047] text-slate-400 bg-[#0D131F]">
              <tr>
                <th className="py-2.5 px-4 font-medium">Mode</th>
                <th className="py-2.5 px-4 font-medium text-right">Original</th>
                <th className="py-2.5 px-4 font-medium text-right">Compressed</th>
                <th className="py-2.5 px-4 font-medium text-right">Header Overhead</th>
                <th className="py-2.5 px-4 font-medium text-right">Ratio</th>
                <th className="py-2.5 px-4 font-medium w-40">Size Bar</th>
                <th className="py-2.5 px-4 font-medium text-right">Comp (ms)</th>
                <th className="py-2.5 px-4 font-medium text-right">Decomp (ms)</th>
                <th className="py-2.5 px-4 font-medium">CRC32 &amp; Round-Trip</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#233047]/60">
              {rows.map((r) => {
                const barWidth = Math.max(4, Math.min(100, r.ratioPercent));
                const ok = r.crcVerified && r.roundtripMatch;
                return (
                  <tr key={r.modeId} className="hover:bg-[#151E2E]/60 transition-colors">
                    <td className="py-3 px-4 font-medium text-slate-100 whitespace-nowrap">
                      {r.modeName}
                      {r.bypassRecommended && (
                        <span className="ml-2 text-[11px] font-mono text-amber-400">
                          (Bypass advised)
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono text-right text-slate-300">
                      {r.originalSize.toLocaleString()} B
                    </td>
                    <td className="py-3 px-4 font-mono text-right font-semibold text-slate-100">
                      {r.compressedSize.toLocaleString()} B
                    </td>
                    <td className="py-3 px-4 font-mono text-right text-slate-400">
                      {r.headerOverhead} B
                    </td>
                    <td
                      className={`py-3 px-4 font-mono text-right font-semibold ${
                        r.ratioPercent < 100 ? 'text-emerald-400' : 'text-amber-400'
                      }`}
                    >
                      {r.ratioPercent.toFixed(2)}%
                    </td>
                    <td className="py-3 px-4">
                      <div className="w-full h-2.5 rounded-full bg-[#0B0F17] border border-[#233047] overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            r.ratioPercent < 100 ? 'bg-sky-400' : 'bg-amber-400'
                          }`}
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono text-right text-slate-300">
                      {r.compressMs.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 font-mono text-right text-slate-300">
                      {r.decompressMs.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 font-mono whitespace-nowrap">
                      <span className={ok ? 'text-emerald-400' : 'text-rose-400'}>
                        {r.crc32Hex} · {ok ? 'PASS' : 'FAIL'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
