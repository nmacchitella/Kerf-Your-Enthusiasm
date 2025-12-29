'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/auth-client';

export function MigrationPrompt() {
  const { data: session } = useSession();
  const router = useRouter();
  const [showPrompt, setShowPrompt] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [localData, setLocalData] = useState<{
    stocks: unknown[];
    cuts: unknown[];
    tools: unknown[];
  } | null>(null);

  useEffect(() => {
    if (!session) {
      setShowPrompt(false);
      return;
    }

    // Check if already migrated
    const migrated = localStorage.getItem('kerf-migrated');
    if (migrated) {
      setShowPrompt(false);
      return;
    }

    // Check for local data
    const stocks = JSON.parse(localStorage.getItem('kerf-your-enthusiasm-stocks') || '[]');
    const cuts = JSON.parse(localStorage.getItem('kerf-your-enthusiasm-cuts') || '[]');
    const tools = JSON.parse(localStorage.getItem('kerf-your-enthusiasm-tools') || '[]');

    if (stocks.length > 0 || cuts.length > 0 || tools.length > 0) {
      setLocalData({ stocks, cuts, tools });
      setShowPrompt(true);
    }
  }, [session]);

  const handleMigrate = async () => {
    if (!localData) return;

    setMigrating(true);
    try {
      const response = await fetch('/api/v1/migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(localData),
      });

      if (response.ok) {
        const result = await response.json();
        localStorage.setItem('kerf-migrated', 'true');
        setShowPrompt(false);

        // Redirect to the imported project if one was created
        if (result.projectId) {
          router.push(`/projects/${result.projectId}`);
        } else {
          router.push('/dashboard');
        }
      }
    } catch (error) {
      console.error('Migration failed:', error);
    } finally {
      setMigrating(false);
    }
  };

  const handleSkip = () => {
    localStorage.setItem('kerf-migrated', 'skipped');
    setShowPrompt(false);
  };

  if (!showPrompt || !localData) return null;

  const totalItems =
    localData.stocks.length + localData.cuts.length + localData.tools.length;

  return (
    <div className="fixed bottom-4 right-4 bg-white p-4 rounded-lg shadow-lg border border-slate-200 max-w-sm z-50">
      <h3 className="font-medium text-slate-900 mb-1">Import Your Data</h3>
      <p className="text-sm text-slate-600 mb-3">
        We found {totalItems} items saved in your browser:
      </p>
      <ul className="text-sm text-slate-500 mb-3 space-y-1">
        {localData.stocks.length > 0 && (
          <li>- {localData.stocks.length} stock sheet(s)</li>
        )}
        {localData.cuts.length > 0 && (
          <li>- {localData.cuts.length} cut(s)/part(s)</li>
        )}
        {localData.tools.length > 0 && (
          <li>- {localData.tools.length} tool(s)</li>
        )}
      </ul>
      <p className="text-sm text-slate-600 mb-4">
        Import them to your account to access from any device.
      </p>
      <div className="flex gap-2">
        <button
          onClick={handleMigrate}
          disabled={migrating}
          className="flex-1 px-3 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 text-sm font-medium disabled:opacity-50 transition-colors"
        >
          {migrating ? 'Importing...' : 'Import All'}
        </button>
        <button
          onClick={handleSkip}
          disabled={migrating}
          className="px-3 py-2 text-slate-600 hover:text-slate-900 text-sm transition-colors"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
