'use client';

import { useState } from 'react';
import { StepBodyRow, StepBody } from './StepBodyRow';

export interface BodyState {
  body: StepBody;
  name: string;
  included: boolean;
  confirmed: boolean; // user explicitly selected a face for this body
}

interface Props {
  bodyStates: BodyState[];
  selectedIndex: number;
  onSelect: (idx: number) => void;
  onToggle: (idx: number) => void;
  onRename: (idx: number, name: string) => void;
  onConfirmAll: () => void;
}

// ── Tree types ────────────────────────────────────────────────────────────────

type BodyNode = { type: 'body'; stateIdx: number };
type FolderNode = { type: 'folder'; name: string; pathKey: string; children: TreeNode[] };
type TreeNode = BodyNode | FolderNode;

function buildTree(bodyStates: BodyState[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const folderByPath = new Map<string, FolderNode>();

  for (let i = 0; i < bodyStates.length; i++) {
    const path = bodyStates[i].body.folder_path;
    let children = roots;
    let pathKey = '';

    for (const segment of path) {
      pathKey += '/' + segment;
      if (!folderByPath.has(pathKey)) {
        const folder: FolderNode = { type: 'folder', name: segment, pathKey, children: [] };
        folderByPath.set(pathKey, folder);
        children.push(folder);
      }
      children = folderByPath.get(pathKey)!.children;
    }

    children.push({ type: 'body', stateIdx: i });
  }

  return roots;
}

// ── FolderRow ─────────────────────────────────────────────────────────────────

function FolderRow({
  node, depth, bodyStates, selectedIndex, expanded, onToggleExpand,
  onSelect, onToggle, onRename,
}: {
  node: FolderNode; depth: number; bodyStates: BodyState[]; selectedIndex: number;
  expanded: boolean; onToggleExpand: () => void;
  onSelect: (idx: number) => void; onToggle: (idx: number) => void; onRename: (idx: number, name: string) => void;
}) {
  return (
    <>
      <div
        className="flex items-center gap-1 py-1.5 hover:bg-slate-50 cursor-pointer select-none"
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={onToggleExpand}
      >
        <span className="text-slate-400 text-xs w-3 shrink-0">{expanded ? '▾' : '▸'}</span>
        <svg
          className="w-3.5 h-3.5 shrink-0 text-amber-400"
          fill="currentColor" viewBox="0 0 20 20"
        >
          <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
        </svg>
        <span className="text-xs text-slate-600 font-medium truncate">{node.name}</span>
      </div>
      {expanded && (
        <TreeLevel
          nodes={node.children} depth={depth + 1} bodyStates={bodyStates}
          selectedIndex={selectedIndex} onSelect={onSelect} onToggle={onToggle} onRename={onRename}
        />
      )}
    </>
  );
}

// ── TreeLevel ─────────────────────────────────────────────────────────────────

function TreeLevel({
  nodes, depth, bodyStates, selectedIndex, onSelect, onToggle, onRename,
}: {
  nodes: TreeNode[]; depth: number; bodyStates: BodyState[]; selectedIndex: number;
  onSelect: (idx: number) => void; onToggle: (idx: number) => void; onRename: (idx: number, name: string) => void;
}) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set(nodes.filter((n) => n.type === 'folder').map((n) => (n as FolderNode).pathKey))
  );

  const toggleFolder = (key: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  return (
    <>
      {nodes.map((node) => {
        if (node.type === 'body') {
          const bs = bodyStates[node.stateIdx];
          return (
            <div key={`body-${node.stateIdx}`} style={{ paddingLeft: `${depth * 14}px` }}>
              <StepBodyRow
                body={bs.body} included={bs.included} name={bs.name} confirmed={bs.confirmed}
                selected={node.stateIdx === selectedIndex}
                onSelect={() => onSelect(node.stateIdx)}
                onToggle={() => onToggle(node.stateIdx)}
                onRename={(name) => onRename(node.stateIdx, name)}
              />
            </div>
          );
        }
        return (
          <FolderRow
            key={`folder-${node.pathKey}`} node={node} depth={depth} bodyStates={bodyStates}
            selectedIndex={selectedIndex} expanded={expandedFolders.has(node.pathKey)}
            onToggleExpand={() => toggleFolder(node.pathKey)}
            onSelect={onSelect} onToggle={onToggle} onRename={onRename}
          />
        );
      })}
    </>
  );
}

// ── Main StepSidebar ──────────────────────────────────────────────────────────

export function StepSidebar({ bodyStates, selectedIndex, onSelect, onToggle, onRename, onConfirmAll }: Props) {
  const includedCount = bodyStates.filter((b) => b.included).length;
  const confirmedCount = bodyStates.filter((b) => b.included && b.confirmed).length;
  const tree = buildTree(bodyStates);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-2 py-2 border-b border-slate-200 shrink-0 space-y-1.5">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Parts ({includedCount}/{bodyStates.length})
        </p>
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400">
            <span className={confirmedCount > 0 ? 'text-emerald-600 font-medium' : ''}>
              {confirmedCount}
            </span>
            /{includedCount} confirmed
          </span>
          <button
            onClick={onConfirmAll}
            className="text-xs text-slate-500 hover:text-slate-800 underline underline-offset-2"
          >
            Confirm all
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        <TreeLevel
          nodes={tree} depth={0} bodyStates={bodyStates} selectedIndex={selectedIndex}
          onSelect={onSelect} onToggle={onToggle} onRename={onRename}
        />
      </div>
    </div>
  );
}
