'use client';

import { useState, useEffect } from 'react';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useSession } from '@/lib/auth-client';
import { Tool } from '@/types';
import { CONDITION_COLORS, TOOL_CATALOG } from '@/lib/constants';

const inputCls =
  'bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm text-slate-800 focus:border-slate-400 outline-none w-full transition-colors';

interface DBTool {
  id: string;
  name: string;
  brand: string;
  model: string;
  condition: 'excellent' | 'good' | 'fair' | 'poor';
  notes: string;
}

export default function ToolsPage() {
  const { data: session } = useSession();

  // Local storage for unauthenticated users
  const [localTools, setLocalTools] = useLocalStorage<Tool[]>('kerf-your-enthusiasm-tools', [
    { id: 1, name: 'Table Saw', brand: 'DeWalt', model: 'DWE7491RS', cond: 'excellent', notes: '10" blade' },
    { id: 2, name: 'Router', brand: 'Bosch', model: '1617EVS', cond: 'good', notes: '2.25 HP' },
    { id: 3, name: 'Sander', brand: 'Festool', model: 'ETS 125', cond: 'excellent', notes: '5" pad' },
  ]);

  // Database tools for authenticated users
  const [dbTools, setDbTools] = useState<DBTool[]>([]);
  const [loadingDb, setLoadingDb] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<Tool | DBTool | null>(null);
  const [catalogFilter, setCatalogFilter] = useState('');
  const [activeTab, setActiveTab] = useState<'inventory' | 'catalog'>('inventory');
  const [form, setForm] = useState<Omit<Tool, 'id'>>({
    name: '',
    brand: '',
    model: '',
    cond: 'good',
    notes: '',
  });

  // Fetch user's tools from database
  useEffect(() => {
    if (session) {
      fetchDbTools();
    }
  }, [session]);

  const fetchDbTools = async () => {
    setLoadingDb(true);
    try {
      const res = await fetch('/api/v1/tools');
      if (res.ok) {
        const data = await res.json();
        setDbTools(data);
      }
    } catch (error) {
      console.error('Failed to fetch tools:', error);
    } finally {
      setLoadingDb(false);
    }
  };

  // Use database tools if authenticated, otherwise local storage
  const tools = session ? dbTools : localTools;
  const isDbMode = !!session;

  const addTool = async () => {
    if (!form.name) return;

    if (isDbMode) {
      try {
        const res = await fetch('/api/v1/tools', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: form.name,
            brand: form.brand,
            model: form.model,
            condition: form.cond,
            notes: form.notes,
          }),
        });
        if (res.ok) {
          const newTool = await res.json();
          setDbTools([...dbTools, newTool]);
        }
      } catch (error) {
        console.error('Failed to add tool:', error);
      }
    } else {
      setLocalTools([...localTools, { ...form, id: Date.now() }]);
    }

    setForm({ name: '', brand: '', model: '', cond: 'good', notes: '' });
    setShowForm(false);
  };

  const deleteTool = async (tool: Tool | DBTool) => {
    if (isDbMode && 'condition' in tool) {
      try {
        const res = await fetch(`/api/v1/tools/${tool.id}`, { method: 'DELETE' });
        if (res.ok) {
          setDbTools(dbTools.filter((t) => t.id !== tool.id));
        }
      } catch (error) {
        console.error('Failed to delete tool:', error);
      }
    } else if ('cond' in tool) {
      setLocalTools(localTools.filter((t) => t.id !== tool.id));
    }
    setDeleteConfirm(null);
  };

  const addFromCatalog = async (catalogTool: typeof TOOL_CATALOG[number]) => {
    if (isDbMode) {
      try {
        const res = await fetch('/api/v1/tools', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: catalogTool.name,
            brand: catalogTool.brand,
            model: catalogTool.model,
            condition: 'good',
            notes: catalogTool.notes,
          }),
        });
        if (res.ok) {
          const newTool = await res.json();
          setDbTools([...dbTools, newTool]);
        }
      } catch (error) {
        console.error('Failed to add tool from catalog:', error);
      }
    } else {
      setLocalTools([...localTools, {
        id: Date.now(),
        name: catalogTool.name,
        brand: catalogTool.brand,
        model: catalogTool.model,
        cond: 'good',
        notes: catalogTool.notes,
      }]);
    }
  };

  const filteredCatalog = TOOL_CATALOG.filter((t) =>
    `${t.name} ${t.brand} ${t.model}`.toLowerCase().includes(catalogFilter.toLowerCase())
  );

  // Helper to get condition from either format
  const getCondition = (tool: Tool | DBTool): Tool['cond'] => {
    return 'cond' in tool ? tool.cond : tool.condition;
  };

  return (
    <>
      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-sm mx-4 shadow-xl">
            <h3 className="text-lg font-medium text-slate-800 mb-2">Delete Tool?</h3>
            <p className="text-slate-600 text-sm mb-4">
              Are you sure you want to delete <strong>{deleteConfirm.name}</strong>
              {deleteConfirm.brand && ` (${deleteConfirm.brand} ${deleteConfirm.model})`}?
              This action cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteTool(deleteConfirm)}
                className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-sm transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="pt-6">
        {/* Auth status banner */}
        {!session && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            Tools are saved locally in your browser. Sign in to save them to your account and access them from any device.
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-4">
          <button
            onClick={() => setActiveTab('inventory')}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              activeTab === 'inventory'
                ? 'bg-white text-slate-800 border border-b-0 border-slate-200'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            My Inventory ({tools.length})
          </button>
          <button
            onClick={() => setActiveTab('catalog')}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              activeTab === 'catalog'
                ? 'bg-white text-slate-800 border border-b-0 border-slate-200'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Tool Catalog
          </button>
        </div>

        {activeTab === 'inventory' ? (
          <div className="flex gap-6">
            {/* Left: Tool Inventory */}
            <div className="flex-1 space-y-4 max-w-2xl">
              <div className="flex justify-between items-center">
                <h2 className="text-lg font-medium text-slate-800">Tool Inventory</h2>
                <button
                  onClick={() => setShowForm(!showForm)}
                  className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm transition-colors"
                >
                  + Add Tool
                </button>
              </div>

              {showForm && (
                <div className="bg-white rounded-md p-4 shadow-sm border border-slate-200 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      placeholder="Tool name *"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className={inputCls}
                    />
                    <input
                      placeholder="Brand"
                      value={form.brand}
                      onChange={(e) => setForm({ ...form, brand: e.target.value })}
                      className={inputCls}
                    />
                    <input
                      placeholder="Model"
                      value={form.model}
                      onChange={(e) => setForm({ ...form, model: e.target.value })}
                      className={inputCls}
                    />
                    <select
                      value={form.cond}
                      onChange={(e) =>
                        setForm({ ...form, cond: e.target.value as Tool['cond'] })
                      }
                      className={inputCls}
                    >
                      <option value="excellent">Excellent</option>
                      <option value="good">Good</option>
                      <option value="fair">Fair</option>
                      <option value="poor">Poor</option>
                    </select>
                  </div>
                  <input
                    placeholder="Notes"
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    className={inputCls}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={addTool}
                      className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm transition-colors"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setShowForm(false)}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-sm transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {loadingDb && isDbMode ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="bg-white rounded-md p-4 shadow-sm border border-slate-200 animate-pulse">
                      <div className="h-4 bg-slate-200 rounded w-1/3 mb-2"></div>
                      <div className="h-3 bg-slate-200 rounded w-1/4"></div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid gap-3">
                  {tools.map((t) => (
                    <div
                      key={t.id}
                      className="bg-white rounded-md p-4 shadow-sm border border-slate-200 flex justify-between items-start group"
                    >
                      <div>
                        <div className="font-medium text-slate-800">{t.name}</div>
                        <div className="text-sm text-slate-500">
                          {t.brand} {t.model}
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <span
                            className={`text-xs px-2 py-0.5 rounded ${CONDITION_COLORS[getCondition(t)]}`}
                          >
                            {getCondition(t)}
                          </span>
                          {t.notes && (
                            <span className="text-xs text-slate-400 italic">{t.notes}</span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => setDeleteConfirm(t)}
                        className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 text-xl transition-opacity"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {tools.length === 0 && (
                    <div className="text-center text-slate-400 py-8">
                      No tools yet. Add your first tool or select from the catalog.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right: Quick Add from Catalog */}
            <div className="w-80 flex-shrink-0 hidden lg:block">
              <div className="sticky top-6 space-y-3">
                <h3 className="text-sm font-medium text-slate-600 uppercase tracking-wide">
                  Quick Add from Catalog
                </h3>
                <input
                  placeholder="Search tools..."
                  value={catalogFilter}
                  onChange={(e) => setCatalogFilter(e.target.value)}
                  className={inputCls}
                />
                <div className="bg-white rounded-md border border-slate-200 shadow-sm max-h-[calc(100vh-250px)] overflow-y-auto">
                  {filteredCatalog.slice(0, 20).map((t, idx) => (
                    <button
                      key={`${t.brand}-${t.model}-${idx}`}
                      onClick={() => addFromCatalog(t)}
                      className="w-full text-left px-3 py-2.5 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors group"
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="text-sm font-medium text-slate-700">{t.name}</div>
                          <div className="text-xs text-slate-500">
                            {t.brand} {t.model}
                          </div>
                        </div>
                        <span className="text-slate-300 group-hover:text-slate-500 text-lg leading-none">
                          +
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-400 text-center">
                  Click a tool to add it to your inventory
                </p>
              </div>
            </div>
          </div>
        ) : (
          /* Catalog Tab */
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <h2 className="text-lg font-medium text-slate-800">Tool Catalog</h2>
              <input
                placeholder="Search tools..."
                value={catalogFilter}
                onChange={(e) => setCatalogFilter(e.target.value)}
                className={`${inputCls} max-w-xs`}
              />
            </div>
            <p className="text-sm text-slate-600">
              Browse our catalog of woodworking tools. Click the + button to add any tool to your inventory.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredCatalog.map((t, idx) => (
                <div
                  key={`${t.brand}-${t.model}-${idx}`}
                  className="bg-white rounded-md p-4 shadow-sm border border-slate-200 flex justify-between items-start group hover:border-slate-300 transition-colors"
                >
                  <div>
                    <div className="font-medium text-slate-700">{t.name}</div>
                    <div className="text-sm text-slate-500">
                      {t.brand} {t.model}
                    </div>
                    {t.notes && (
                      <div className="text-xs text-slate-400 mt-1">{t.notes}</div>
                    )}
                  </div>
                  <button
                    onClick={() => addFromCatalog(t)}
                    className="text-slate-300 hover:text-slate-600 text-2xl leading-none transition-colors"
                    title="Add to inventory"
                  >
                    +
                  </button>
                </div>
              ))}
            </div>
            {filteredCatalog.length === 0 && (
              <div className="text-center text-slate-400 py-8">
                No tools match your search.
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
