'use client';

import { useEffect } from 'react';

interface KeyboardHandlers {
  onRotate: () => void;
  onDelete: () => void;
  onEscape: () => void;
  onSelectAll: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onPin: () => void;
  onUnpin: () => void;
}

/** Attach global keyboard shortcuts for the layout editor. */
export function useKeyboardShortcuts(handlers: KeyboardHandlers) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Don't fire inside text inputs
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) return;

      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.key === 'z') {
        e.preventDefault();
        handlers.onUndo();
        return;
      }
      if (ctrl && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
        e.preventDefault();
        handlers.onRedo();
        return;
      }
      if (ctrl && e.key === 'a') {
        e.preventDefault();
        handlers.onSelectAll();
        return;
      }

      switch (e.key) {
        case 'r':
        case 'R':
          handlers.onRotate();
          break;
        case 'Delete':
        case 'Backspace':
          handlers.onDelete();
          break;
        case 'Escape':
          handlers.onEscape();
          break;
        case 'p':
        case 'P':
          if (e.shiftKey) handlers.onUnpin();
          else handlers.onPin();
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlers]);
}
