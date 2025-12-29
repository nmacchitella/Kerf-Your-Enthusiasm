'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to console in development
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
      <h1 className="text-6xl font-bold text-slate-300 mb-4">Oops</h1>
      <h2 className="text-xl font-medium text-slate-700 mb-2">Something went wrong</h2>
      <p className="text-slate-500 mb-6 max-w-md">
        The saw blade slipped. We encountered an unexpected error.
      </p>
      <button
        onClick={reset}
        className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm font-medium transition-colors"
      >
        Try Again
      </button>
    </div>
  );
}
