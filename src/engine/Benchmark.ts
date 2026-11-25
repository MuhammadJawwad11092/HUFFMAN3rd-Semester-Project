import { compressBytes, CompressionModeId } from './Compression';
import { formatCrc32Hex } from './CRC32';
import { decompressBytes } from './Decompression';

export type BenchmarkPreset = 'team_default' | 'logs' | 'dna' | 'json' | 'english';

export interface BenchmarkRow {
  modeId: CompressionModeId;
  modeName: string;
  originalSize: number;
  compressedSize: number;
  headerOverhead: number;
  payloadBytes: number;
  ratioPercent: number;
  savingsPercent: number;
  compressMs: number;
  decompressMs: number;
  crc32Hex: string;
  crcVerified: boolean;
  roundtripMatch: boolean;
  bypassRecommended: boolean;
}

export const XRAY_PRESETS: Record<BenchmarkPreset, { label: string; sampleText: string }> = {
  team_default: {
    label: 'input.txt (Team Default)',
    sampleText: 'AAAABBBBCCCCDDDDEEEEE',
  },
  logs: {
    label: 'Server Error Logs',
    sampleText:
      '2026-11-25T14:02:11Z [ERROR] svc=edge-proxy ip=10.24.18.12 path=/api/v2/auth status=502 msg="timeout"\n' +
      '2026-11-25T14:02:12Z [ERROR] svc=edge-proxy ip=10.24.18.12 path=/api/v2/auth status=502 msg="timeout"\n' +
      '2026-11-25T14:02:13Z [INFO]  svc=edge-proxy ip=10.24.18.14 path=/healthz status=200 msg="ok"\n',
  },
  dna: {
    label: 'DNA FASTA Sequence',
    sampleText: '>CHR_001_SEGMENT\nATCGATCGATCGTAGCTAGCTAGCTA\nGGGGAAAACCCCTTTTATCGATCGAT\nATATATATATGCGCGCGCGTAGCTAG\n',
  },
  json: {
    label: 'Sensor JSON Telemetry',
    sampleText:
      '[{"id":"rack-01","temp":22.4,"hum":48.5,"ok":true},{"id":"rack-02","temp":22.5,"hum":48.0,"ok":true}]',
  },
  english: {
    label: 'English Technical Prose',
    sampleText:
      'Huffman coding assigns variable-length prefix-free binary codes based on byte frequency statistics in the input stream.',
  },
};

export function generateBenchmarkDataset(preset: BenchmarkPreset, targetBytes = 32768): Uint8Array {
  if (preset === 'team_default') {
    return new TextEncoder().encode(XRAY_PRESETS.team_default.sampleText);
  }

  let out = '';
  if (preset === 'logs') {
    const levels = ['INFO', 'WARN', 'ERROR', 'DEBUG'];
    const paths = ['/api/v2/auth/token', '/api/v2/telemetry/ingest', '/api/v2/users/profile', '/healthz'];
    const msgs = [
      'Connection pool exhausted retrying in 250ms',
      'Upstream gateway timeout on worker-node-04',
      'Request completed successfully cache=HIT',
      'TLS handshake verified session_reused=true',
    ];
    let seq = 0;
    while (out.length < targetBytes) {
      const mm = String(Math.floor(seq / 60) % 60).padStart(2, '0');
      const ss = String(seq % 60).padStart(2, '0');
      out += `2026-11-25T14:${mm}:${ss}Z [${levels[seq % 4]}] svc=edge-proxy ip=10.24.18.${10 + (seq % 12)} path=${paths[seq % 4]} status=${seq % 4 === 2 ? 502 : 200} msg="${msgs[seq % 4]}"\n`;
      seq++;
    }
  } else if (preset === 'dna') {
    const motifs = [
      'ATCGATCGATCGTAGCTAGCTAGCTA',
      'GGGGAAAACCCCTTTTATCGATCGAT',
      'ATATATATATGCGCGCGCGTAGCTAG',
      'CGTACGTACGTAGCTAGCTAGAAAAA',
    ];
    let seq = 1;
    while (out.length < targetBytes) {
      out += `>CHR_${String(seq++).padStart(3, '0')}_HOMO_SAPIENS\n`;
      for (let i = 0; i < 6 && out.length < targetBytes; i++) {
        out += motifs[(seq + i) % 4] + motifs[(seq + i + 1) % 4] + '\n';
      }
    }
  } else if (preset === 'json') {
    let seq = 0;
    out += '[\n';
    while (out.length + 120 < targetBytes) {
      out += `  {"device_id":"sensor-rack-${String((seq % 8) + 1).padStart(2, '0')}","ts":179561${String(seq % 10000).padStart(4, '0')},"temp_c":${(22.4 + (seq % 5) * 0.15).toFixed(2)},"humidity":${(48 + (seq % 7) * 0.5).toFixed(1)},"ok":true},\n`;
      seq++;
    }
    out += ']\n';
  } else {
    const sentences = [
      'Data compression reduces the number of bits required to represent information while preserving exact fidelity. ',
      'Huffman coding assigns variable-length prefix-free binary codes based on symbol frequency statistics. ',
      'Canonical Huffman coding eliminates full tree topology serialization by transmitting only symbol bit lengths. ',
      'Bitwise MSB-first packing accumulates bits into an 8-bit register before flushing completed bytes to the stream.\n',
    ];
    let idx = 0;
    while (out.length < targetBytes) {
      out += sentences[idx % sentences.length];
      idx++;
    }
  }

  const encoded = new TextEncoder().encode(out);
  return encoded.length > targetBytes ? encoded.subarray(0, targetBytes) : encoded;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function runBenchmarkSuite(data: Uint8Array): BenchmarkRow[] {
  const modes: CompressionModeId[] = [0, 1, 2];
  return modes.map((modeId) => {
    const comp = compressBytes(data, {
      container: 'huf2',
      mode: modeId,
      allowSmartBypass: false,
      trace: false,
    });
    const dec = decompressBytes(comp.data);
    const ratioPercent = data.length === 0 ? 100 : (100 * comp.compressedSize) / data.length;
    return {
      modeId,
      modeName: comp.modeName,
      originalSize: data.length,
      compressedSize: comp.compressedSize,
      headerOverhead: comp.headerBytes + comp.treeHeaderBytes,
      payloadBytes: comp.payloadBytes,
      ratioPercent,
      savingsPercent: 100 - ratioPercent,
      compressMs: comp.durationMs,
      decompressMs: dec.durationMs,
      crc32Hex: formatCrc32Hex(comp.crc32),
      crcVerified: dec.crcVerified === true,
      roundtripMatch: dec.success && bytesEqual(dec.data, data),
      bypassRecommended: modeId !== 0 && comp.compressedSize >= data.length + 17,
    };
  });
}
