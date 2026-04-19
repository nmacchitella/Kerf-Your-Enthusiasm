'use client';

import { useReducer, useEffect, useCallback } from 'react';
import type { ManualOverrides, ManualOverride, PartInstanceKey, PlacedCut, OptimizationResult } from '@/types';

// ── Action types ──────────────────────────────────────────────────────────────

export type LayoutAction =
  | { type: 'MOVE'; key: PartInstanceKey; x: number; y: number; sheetIndex: number }
  | { type: 'ROTATE'; key: PartInstanceKey; cut: PlacedCut; currentOverride?: ManualOverride }
  | { type: 'PIN'; key: PartInstanceKey; x: number; y: number; rot: boolean; sheetIndex: number }
  | { type: 'UNPIN'; key: PartInstanceKey }
  | { type: 'ASSIGN_SHEET'; key: PartInstanceKey; sheetIndex: number }
  | { type: 'REMOVE_FROM_SHEET'; key: PartInstanceKey }
  | { type: 'SELECT'; keys: PartInstanceKey[]; additive: boolean }
  | { type: 'DESELECT_ALL' }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'LOAD'; overrides: ManualOverrides }
  | { type: 'RESET' }
  | { type: 'CLEAR_STALE_KEYS'; validKeys: Set<PartInstanceKey> };

// ── State ─────────────────────────────────────────────────────────────────────

export interface LayoutEditorState {
  overrides: ManualOverrides;
  selectedKeys: Set<PartInstanceKey>;
  undoStack: ManualOverrides[];
  redoStack: ManualOverrides[];
}

const MAX_UNDO = 50;

const initialState: LayoutEditorState = {
  overrides: {},
  selectedKeys: new Set(),
  undoStack: [],
  redoStack: [],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function pushUndo(state: LayoutEditorState, prevOverrides: ManualOverrides): LayoutEditorState {
  const undoStack = [prevOverrides, ...state.undoStack].slice(0, MAX_UNDO);
  return { ...state, undoStack, redoStack: [] };
}

// ── Reducer ───────────────────────────────────────────────────────────────────

function layoutReducer(state: LayoutEditorState, action: LayoutAction): LayoutEditorState {
  switch (action.type) {
    case 'MOVE': {
      const prev = state.overrides;
      const existing = prev[action.key] ?? { pinned: false };
      const next: ManualOverrides = {
        ...prev,
        [action.key]: { ...existing, x: action.x, y: action.y, sheetIndex: action.sheetIndex, pinned: true },
      };
      return pushUndo({ ...state, overrides: next }, prev);
    }

    case 'ROTATE': {
      const prev = state.overrides;
      const existing = prev[action.key];
      // Toggle rotation relative to current effective rotation
      const currentRot = existing?.rot ?? action.cut.rot;
      const newRot = !currentRot;
      // Recompute pw/ph
      const next: ManualOverrides = {
        ...prev,
        [action.key]: {
          ...(existing ?? { pinned: false }),
          rot: newRot,
        },
      };
      return pushUndo({ ...state, overrides: next }, prev);
    }

    case 'PIN': {
      const prev = state.overrides;
      const next: ManualOverrides = {
        ...prev,
        [action.key]: { x: action.x, y: action.y, rot: action.rot, sheetIndex: action.sheetIndex, pinned: true },
      };
      return pushUndo({ ...state, overrides: next }, prev);
    }

    case 'UNPIN': {
      const prev = state.overrides;
      const existing = prev[action.key];
      if (!existing) return state;
      // Remove position lock but keep sheet assignment
      const next: ManualOverrides = {
        ...prev,
        [action.key]: { sheetIndex: existing.sheetIndex, pinned: false },
      };
      return pushUndo({ ...state, overrides: next }, prev);
    }

    case 'ASSIGN_SHEET': {
      const prev = state.overrides;
      const existing = prev[action.key] ?? { pinned: false };
      const next: ManualOverrides = {
        ...prev,
        [action.key]: { ...existing, sheetIndex: action.sheetIndex },
      };
      return pushUndo({ ...state, overrides: next }, prev);
    }

    case 'REMOVE_FROM_SHEET': {
      const prev = state.overrides;
      // Remove all override info — part goes back to unplaced pool
      const next = { ...prev };
      delete next[action.key];
      return pushUndo({ ...state, overrides: next }, prev);
    }

    case 'SELECT': {
      let next: Set<PartInstanceKey>;
      if (action.additive) {
        next = new Set(state.selectedKeys);
        for (const k of action.keys) {
          if (next.has(k)) next.delete(k);
          else next.add(k);
        }
      } else {
        next = new Set(action.keys);
      }
      // Selection doesn't push undo
      return { ...state, selectedKeys: next };
    }

    case 'DESELECT_ALL':
      return { ...state, selectedKeys: new Set() };

    case 'UNDO': {
      if (state.undoStack.length === 0) return state;
      const [prev, ...rest] = state.undoStack;
      return {
        ...state,
        overrides: prev,
        undoStack: rest,
        redoStack: [state.overrides, ...state.redoStack].slice(0, MAX_UNDO),
      };
    }

    case 'REDO': {
      if (state.redoStack.length === 0) return state;
      const [next, ...rest] = state.redoStack;
      return {
        ...state,
        overrides: next,
        undoStack: [state.overrides, ...state.undoStack].slice(0, MAX_UNDO),
        redoStack: rest,
      };
    }

    case 'LOAD':
      return { ...state, overrides: action.overrides, undoStack: [], redoStack: [] };

    case 'RESET':
      return { ...initialState };

    case 'CLEAR_STALE_KEYS': {
      const next: ManualOverrides = {};
      for (const [key, ov] of Object.entries(state.overrides)) {
        if (action.validKeys.has(key)) next[key] = ov;
      }
      if (Object.keys(next).length === Object.keys(state.overrides).length) return state;
      return { ...state, overrides: next };
    }

    default:
      return state;
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useLayoutEditor(
  projectId: string,
  result: OptimizationResult | null,
  initialOverrides?: ManualOverrides | null
) {
  const [state, dispatch] = useReducer(layoutReducer, initialState);
  const hydrated = initialOverrides !== undefined;

  // Load the persisted override payload supplied by the project API.
  useEffect(() => {
    if (!projectId) return;
    if (initialOverrides === undefined) return;
    dispatch({ type: 'LOAD', overrides: initialOverrides ?? {} });
  }, [initialOverrides, projectId]);

  // Purge stale keys when cuts change
  useEffect(() => {
    if (!result) return;
    const validKeys = new Set<PartInstanceKey>();
    for (const sheet of result.sheets) {
      for (const cut of sheet.cuts) validKeys.add(cut.instanceKey);
    }
    for (const cut of result.unplaced) {
      if ('instanceKey' in cut) validKeys.add((cut as PlacedCut).instanceKey);
    }
    dispatch({ type: 'CLEAR_STALE_KEYS', validKeys });
  }, [result]);

  // Convenience helpers that dispatch multiple keys at once (for multi-select ops)
  const moveSelected = useCallback(
    (deltaX: number, deltaY: number, allSheets: OptimizationResult['sheets']) => {
      for (const key of state.selectedKeys) {
        const ov = state.overrides[key];
        // Find current position
        let sourceX = 0, sourceY = 0, sourceSheet = 0;
        for (let i = 0; i < allSheets.length; i++) {
          const cut = allSheets[i].cuts.find(c => c.instanceKey === key);
          if (cut) {
            sourceX = ov?.x ?? cut.x;
            sourceY = ov?.y ?? cut.y;
            sourceSheet = ov?.sheetIndex ?? i;
            break;
          }
        }
        dispatch({
          type: 'MOVE',
          key,
          x: sourceX + deltaX,
          y: sourceY + deltaY,
          sheetIndex: sourceSheet,
        });
      }
    },
    [state.selectedKeys, state.overrides]
  );

  const rotateSelected = useCallback(
    (allSheets: OptimizationResult['sheets']) => {
      for (const key of state.selectedKeys) {
        for (const sheet of allSheets) {
          const cut = sheet.cuts.find(c => c.instanceKey === key);
          if (cut) {
            dispatch({ type: 'ROTATE', key, cut, currentOverride: state.overrides[key] });
            break;
          }
        }
      }
    },
    [state.selectedKeys, state.overrides]
  );

  const removeSelected = useCallback(() => {
    for (const key of state.selectedKeys) {
      dispatch({ type: 'REMOVE_FROM_SHEET', key });
    }
    dispatch({ type: 'DESELECT_ALL' });
  }, [state.selectedKeys]);

  const pinSelected = useCallback(
    (allSheets: OptimizationResult['sheets']) => {
      for (const key of state.selectedKeys) {
        const ov = state.overrides[key];
        for (let i = 0; i < allSheets.length; i++) {
          const cut = allSheets[i].cuts.find(c => c.instanceKey === key);
          if (cut) {
            dispatch({
              type: 'PIN',
              key,
              x: ov?.x ?? cut.x,
              y: ov?.y ?? cut.y,
              rot: ov?.rot ?? cut.rot,
              sheetIndex: ov?.sheetIndex ?? i,
            });
            break;
          }
        }
      }
    },
    [state.selectedKeys, state.overrides]
  );

  const unpinSelected = useCallback(() => {
    for (const key of state.selectedKeys) {
      dispatch({ type: 'UNPIN', key });
    }
  }, [state.selectedKeys]);

  return {
    hydrated,
    overrides: state.overrides,
    selectedKeys: state.selectedKeys,
    canUndo: state.undoStack.length > 0,
    canRedo: state.redoStack.length > 0,
    dispatch,
    moveSelected,
    rotateSelected,
    removeSelected,
    pinSelected,
    unpinSelected,
  };
}
