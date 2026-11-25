import React, { useMemo, useState } from 'react';
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { TraceEvent, TraceNodeInfo } from '../engine/TraceLogger';

interface HuffmanTreeVisualizerProps {
  treeNodes: TraceNodeInfo[];
  mergedNodeIds: Set<number>;
  activeEvent: TraceEvent | null;
  highlightChar: number | null;
  onSelectChar: (char: number | null) => void;
  codes: Map<number, string>;
}

interface PositionedNode {
  node: TraceNodeInfo;
  x: number;
  y: number;
  expanded: boolean;
}

export const HuffmanTreeVisualizer: React.FC<HuffmanTreeVisualizerProps> = ({
  treeNodes,
  mergedNodeIds,
  activeEvent,
  highlightChar,
  onSelectChar,
  codes,
}) => {
  const [zoom, setZoom] = useState(1);

  const byId = useMemo(() => {
    const map = new Map<number, TraceNodeInfo>();
    for (const n of treeNodes) map.set(n.id, n);
    return map;
  }, [treeNodes]);

  const showFullTree =
    activeEvent === null ||
    activeEvent.phase === 'codes' ||
    activeEvent.phase === 'packing' ||
    activeEvent.phase === 'decode';

  // Compute active path edges/nodes when hovering a symbol, pushing bits, or decoding
  const { activePathNodes, activePathEdges, currentTraversalNodeId, pathBitString } = useMemo(() => {
    const pNodes = new Set<number>();
    const pEdges = new Set<string>();
    let curId: number | null = null;
    let bitStr = '';

    // Find tree root (node with no parent among visible)
    const hasParent = new Set<number>();
    for (const n of treeNodes) {
      if (n.leftId !== null) hasParent.add(n.leftId);
      if (n.rightId !== null) hasParent.add(n.rightId);
    }
    const rootNode = treeNodes.find((n) => !hasParent.has(n.id)) ?? null;

    // Priority 1: hovered/selected leaf symbol OR active BIT_PUSH / CODE_ASSIGN character
    const targetChar =
      highlightChar !== null
        ? highlightChar
        : activeEvent?.type === 'BIT_PUSH' || activeEvent?.type === 'CODE_ASSIGN'
        ? activeEvent.character ?? null
        : null;

    if (rootNode && targetChar !== null && showFullTree) {
      const code = codes.get(targetChar) ?? activeEvent?.code ?? '';
      if (code.length > 0) {
        bitStr = code;
        let cur: TraceNodeInfo | undefined = rootNode;
        pNodes.add(cur.id);
        for (let i = 0; i < code.length && cur; i++) {
          const nextId = code[i] === '0' ? cur.leftId : cur.rightId;
          if (nextId === null) break;
          pEdges.add(`${cur.id}->${nextId}`);
          pNodes.add(nextId);
          cur = byId.get(nextId);
        }
        if (cur) curId = cur.id;
      }
    }

    // Priority 2: active DECODE_STEP or DECODE_CHAR path from root
    if (
      rootNode &&
      (activeEvent?.type === 'DECODE_STEP' || activeEvent?.type === 'DECODE_CHAR')
    ) {
      curId = activeEvent.toId ?? null;
      if (activeEvent.fromId !== undefined && activeEvent.toId !== undefined) {
        pEdges.add(`${activeEvent.fromId}->${activeEvent.toId}`);
        pNodes.add(activeEvent.fromId);
        pNodes.add(activeEvent.toId);
      }
      // Also light up full root-to-target path by DFS
      const findPath = (nodeId: number, targetId: number, accBits: string): boolean => {
        if (nodeId === targetId) {
          pNodes.add(nodeId);
          bitStr = accBits;
          return true;
        }
        const n = byId.get(nodeId);
        if (!n) return false;
        if (n.leftId !== null && findPath(n.leftId, targetId, accBits + '0')) {
          pNodes.add(nodeId);
          pEdges.add(`${nodeId}->${n.leftId}`);
          return true;
        }
        if (n.rightId !== null && findPath(n.rightId, targetId, accBits + '1')) {
          pNodes.add(nodeId);
          pEdges.add(`${nodeId}->${n.rightId}`);
          return true;
        }
        return false;
      };
      if (curId !== null) {
        findPath(rootNode.id, curId, '');
      }
    }

    return {
      activePathNodes: pNodes,
      activePathEdges: pEdges,
      currentTraversalNodeId: curId,
      pathBitString: bitStr,
    };
  }, [treeNodes, byId, highlightChar, activeEvent, showFullTree, codes]);

  // Layout tree or current Min-Heap forest
  const { positioned, width, height } = useMemo(() => {
    if (treeNodes.length === 0) {
      return { positioned: new Map<number, PositionedNode>(), width: 720, height: 340 };
    }

    const visibleIds = new Set<number>();
    const hasParent = new Set<number>();

    for (const n of treeNodes) {
      const isExpandedInternal = !n.isLeaf && (showFullTree || mergedNodeIds.has(n.id));
      if (n.isLeaf || isExpandedInternal) {
        visibleIds.add(n.id);
        if (isExpandedInternal) {
          if (n.leftId !== null) hasParent.add(n.leftId);
          if (n.rightId !== null) hasParent.add(n.rightId);
        }
      }
    }

    const roots: TraceNodeInfo[] = [];
    for (const id of visibleIds) {
      if (!hasParent.has(id)) {
        const node = byId.get(id);
        if (node) roots.push(node);
      }
    }

    const countVisibleLeaves = (n: TraceNodeInfo | undefined): number => {
      if (!n) return 0;
      const expanded = !n.isLeaf && (showFullTree || mergedNodeIds.has(n.id));
      if (!expanded) return 1;
      return countVisibleLeaves(n.leftId ? byId.get(n.leftId) : undefined) +
        countVisibleLeaves(n.rightId ? byId.get(n.rightId) : undefined);
    };

    const totalLeaves = Math.max(1, roots.reduce((acc, r) => acc + countVisibleLeaves(r), 0));
    const slotW = Math.max(54, Math.min(82, 680 / totalLeaves));
    const svgW = Math.max(720, totalLeaves * slotW + 64);

    let maxDepth = 0;
    const measureDepth = (n: TraceNodeInfo | undefined, d: number) => {
      if (!n) return;
      maxDepth = Math.max(maxDepth, d);
      const expanded = !n.isLeaf && (showFullTree || mergedNodeIds.has(n.id));
      if (expanded) {
        if (n.leftId) measureDepth(byId.get(n.leftId), d + 1);
        if (n.rightId) measureDepth(byId.get(n.rightId), d + 1);
      }
    };
    roots.forEach((r) => measureDepth(r, 0));

    const levelH = 62;
    const svgH = Math.max(340, (maxDepth + 1) * levelH + 64);

    const posMap = new Map<number, PositionedNode>();
    let leafCursor = 0;

    const place = (n: TraceNodeInfo | undefined, depth: number): number => {
      if (!n) return 0;
      const expanded = !n.isLeaf && (showFullTree || mergedNodeIds.has(n.id));
      let x = 0;
      if (!expanded) {
        x = 32 + (leafCursor + 0.5) * slotW;
        leafCursor++;
      } else {
        const lx = place(n.leftId ? byId.get(n.leftId) : undefined, depth + 1);
        const rx = place(n.rightId ? byId.get(n.rightId) : undefined, depth + 1);
        x = (lx + rx) / 2;
      }
      const y = 36 + depth * levelH;
      posMap.set(n.id, { node: n, x, y, expanded });
      return x;
    };

    roots.forEach((r) => place(r, 0));
    return { positioned: posMap, width: svgW, height: svgH };
  }, [treeNodes, byId, mergedNodeIds, showFullTree]);

  const nodesArray = Array.from(positioned.values());

  return (
    <div className="flex flex-col h-full bg-[#111827] border border-[#233047] rounded-xl overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-[#233047]">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">
            Interactive Binary Huffman Tree
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {pathBitString
              ? `Active traversal path: ${pathBitString} (0 = Left, 1 = Right)`
              : '0 = Left edge · 1 = Right edge · Click any leaf to glow its path'}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.15).toFixed(2)))}
            className="p-1.5 rounded-md border border-[#233047] bg-[#0D131F] text-slate-300 hover:text-sky-400 hover:border-sky-500/50 transition-colors"
            title="Zoom out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs font-mono text-slate-400 w-11 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(2, +(z + 0.15).toFixed(2)))}
            className="p-1.5 rounded-md border border-[#233047] bg-[#0D131F] text-slate-300 hover:text-sky-400 hover:border-sky-500/50 transition-colors"
            title="Zoom in"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setZoom(1);
              onSelectChar(null);
            }}
            className="p-1.5 rounded-md border border-[#233047] bg-[#0D131F] text-slate-300 hover:text-sky-400 hover:border-sky-500/50 transition-colors"
            title="Reset zoom and selection"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-[#0B0F17] p-3">
        {nodesArray.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-xs text-slate-400">
            Enter input text or run a trace to build the Binary Huffman Tree.
          </div>
        ) : (
          <svg
            width={width * zoom}
            height={height * zoom}
            viewBox={`0 0 ${width} ${height}`}
            className="mx-auto block select-none"
          >
            <defs>
              <filter id="glowCyan" x="-40%" y="-40%" width="180%" height="180%">
                <feGaussianBlur stdDeviation="3.5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Edges */}
            {nodesArray.map(({ node, x, y, expanded }) => {
              if (!expanded) return null;
              const children: Array<{ cid: number | null; bit: '0' | '1' }> = [
                { cid: node.leftId, bit: '0' },
                { cid: node.rightId, bit: '1' },
              ];
              return children.map(({ cid, bit }) => {
                if (cid === null) return null;
                const cp = positioned.get(cid);
                if (!cp) return null;
                const edgeKey = `${node.id}->${cid}`;
                const isGlowing = activePathEdges.has(edgeKey);
                const isLatestMerge =
                  activeEvent?.type === 'EXTRACT_MERGE' && activeEvent.parentId === node.id;

                const stroke = isGlowing
                  ? bit === '0'
                    ? '#38BDF8'
                    : '#F59E0B'
                  : isLatestMerge
                  ? '#10B981'
                  : '#2A3954';
                const mx = (x + cp.x) / 2;
                const my = (y + cp.y) / 2;

                return (
                  <g key={edgeKey}>
                    <line
                      x1={x}
                      y1={y}
                      x2={cp.x}
                      y2={cp.y}
                      stroke={stroke}
                      strokeWidth={isGlowing || isLatestMerge ? 2.8 : 1.5}
                      filter={isGlowing ? 'url(#glowCyan)' : undefined}
                    />
                    <rect
                      x={mx - 8}
                      y={my - 9}
                      width={16}
                      height={16}
                      rx={4}
                      fill={isGlowing ? '#0F172A' : '#0B0F17'}
                      stroke={isGlowing ? stroke : '#233047'}
                      strokeWidth={1}
                    />
                    <text
                      x={mx}
                      y={my + 2.5}
                      textAnchor="middle"
                      fontSize="10"
                      fontWeight="700"
                      fontFamily="JetBrains Mono, monospace"
                      fill={isGlowing ? stroke : '#94A3B8'}
                    >
                      {bit}
                    </text>
                  </g>
                );
              });
            })}

            {/* Nodes */}
            {nodesArray.map(({ node, x, y }) => {
              const isMergeHighlight =
                activeEvent?.type === 'EXTRACT_MERGE' &&
                (node.id === activeEvent.parentId ||
                  node.id === activeEvent.leftId ||
                  node.id === activeEvent.rightId);
              const isPathNode = activePathNodes.has(node.id);
              const isCursor = currentTraversalNodeId === node.id;
              const isUserSelected =
                highlightChar !== null && node.isLeaf && node.character === highlightChar;

              let fill = node.isLeaf ? '#16253B' : '#151E2E';
              let stroke = node.isLeaf ? '#38BDF8' : '#334155';
              let textColor = '#F1F5F9';

              if (isCursor || isUserSelected) {
                fill = '#F59E0B';
                stroke = '#FDE68A';
                textColor = '#0B0F17';
              } else if (isMergeHighlight) {
                fill = '#10B981';
                stroke = '#6EE7B7';
                textColor = '#0B0F17';
              } else if (isPathNode) {
                fill = '#0EA5E9';
                stroke = '#BAE6FD';
                textColor = '#0B0F17';
              }

              const radius = node.isLeaf ? 18 : 15;

              return (
                <g
                  key={node.id}
                  onClick={() =>
                    node.isLeaf
                      ? onSelectChar(highlightChar === node.character ? null : node.character)
                      : undefined
                  }
                  style={{ cursor: node.isLeaf ? 'pointer' : 'default' }}
                  filter={isCursor || isPathNode ? 'url(#glowCyan)' : undefined}
                >
                  <circle
                    cx={x}
                    cy={y}
                    r={radius}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={isCursor || isPathNode || isMergeHighlight ? 2.4 : 1.5}
                  />
                  <text
                    x={x}
                    y={y + 3.5}
                    textAnchor="middle"
                    fontSize={node.isLeaf ? '10.5' : '10'}
                    fontWeight="700"
                    fontFamily="JetBrains Mono, monospace"
                    fill={textColor}
                  >
                    {node.isLeaf ? node.label : node.freq}
                  </text>
                  {node.isLeaf && (
                    <text
                      x={x}
                      y={y + radius + 13}
                      textAnchor="middle"
                      fontSize="9.5"
                      fontFamily="JetBrains Mono, monospace"
                      fill="#94A3B8"
                    >
                      f={node.freq}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
};
