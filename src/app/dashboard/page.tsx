'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSession } from '@/lib/auth-client';

interface Project {
  id: string;
  name: string;
  description: string | null;
  kerf: number;
  createdAt: string;
  updatedAt: string;
  stocks: Array<{ id: string; name: string }>;
  cuts: Array<{ id: string; label: string }>;
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      const res = await fetch('/api/v1/projects');
      if (res.ok) {
        const data = await res.json();
        setProjects(data);
      }
    } catch (error) {
      console.error('Failed to fetch projects:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;

    setCreating(true);
    try {
      const res = await fetch('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newProjectName }),
      });

      if (res.ok) {
        const project = await res.json();
        setProjects([project, ...projects]);
        setNewProjectName('');
        setShowNewForm(false);
      }
    } catch (error) {
      console.error('Failed to create project:', error);
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteProject = async (id: string) => {
    if (!confirm('Are you sure you want to delete this project?')) return;

    try {
      const res = await fetch(`/api/v1/projects/${id}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        setProjects(projects.filter((p) => p.id !== id));
      }
    } catch (error) {
      console.error('Failed to delete project:', error);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-200 rounded w-1/4"></div>
          <div className="h-32 bg-slate-200 rounded"></div>
          <div className="h-32 bg-slate-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">My Projects</h1>
          <p className="text-slate-600 mt-1">
            Welcome back, {session?.user.name || 'there'}
          </p>
        </div>
        <button
          onClick={() => setShowNewForm(true)}
          className="px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors text-sm font-medium"
        >
          New Project
        </button>
      </div>

      {showNewForm && (
        <div className="mb-6 p-4 bg-white rounded-lg border border-slate-200">
          <form onSubmit={handleCreateProject} className="flex gap-3">
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="Project name..."
              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
              autoFocus
            />
            <button
              type="submit"
              disabled={creating || !newProjectName.trim()}
              className="px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors text-sm font-medium disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowNewForm(false);
                setNewProjectName('');
              }}
              className="px-4 py-2 text-slate-600 hover:text-slate-900 transition-colors text-sm"
            >
              Cancel
            </button>
          </form>
        </div>
      )}

      {projects.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-slate-200">
          <div className="text-slate-400 text-5xl mb-4">📐</div>
          <h3 className="text-lg font-medium text-slate-900 mb-2">
            No projects yet
          </h3>
          <p className="text-slate-600 mb-4">
            Create your first project to start planning cuts
          </p>
          <button
            onClick={() => setShowNewForm(true)}
            className="px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors text-sm font-medium"
          >
            Create Project
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {projects.map((project) => (
            <div
              key={project.id}
              className="bg-white rounded-lg border border-slate-200 p-4 hover:border-slate-300 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <Link
                    href={`/projects/${project.id}`}
                    className="text-lg font-medium text-slate-900 hover:text-slate-600"
                  >
                    {project.name}
                  </Link>
                  {project.description && (
                    <p className="text-slate-600 text-sm mt-1">
                      {project.description}
                    </p>
                  )}
                  <div className="flex items-center gap-4 mt-2 text-sm text-slate-500">
                    <span>{project.stocks.length} stocks</span>
                    <span>{project.cuts.length} cuts</span>
                    <span>Kerf: {project.kerf}&quot;</span>
                    <span>Updated {formatDate(project.updatedAt)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/projects/${project.id}`}
                    className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors"
                  >
                    Open
                  </Link>
                  <button
                    onClick={() => handleDeleteProject(project.id)}
                    className="px-3 py-1.5 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 p-4 bg-slate-50 rounded-lg border border-slate-200">
        <h3 className="font-medium text-slate-900 mb-2">Quick Actions</h3>
        <div className="flex gap-3">
          <Link
            href="/cut-list"
            className="text-sm text-slate-600 hover:text-slate-900"
          >
            Open Cut List (without saving)
          </Link>
          <span className="text-slate-300">|</span>
          <Link
            href="/tools"
            className="text-sm text-slate-600 hover:text-slate-900"
          >
            Manage Tools
          </Link>
          <span className="text-slate-300">|</span>
          <Link
            href="/calculators"
            className="text-sm text-slate-600 hover:text-slate-900"
          >
            Calculators
          </Link>
        </div>
      </div>
    </div>
  );
}
