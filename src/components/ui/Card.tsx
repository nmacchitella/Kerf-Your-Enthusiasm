'use client';

import { ReactNode } from 'react';

interface CardProps {
  title: string;
  children: ReactNode;
  className?: string;
}

export function Card({ title, children, className = '' }: CardProps) {
  return (
    <div className={`bg-stone-800 rounded-lg p-4 ${className}`}>
      <h3 className="text-amber-400 font-medium mb-3">{title}</h3>
      {children}
    </div>
  );
}

interface ResultProps {
  label: string;
  value: string | number;
  warn?: boolean;
}

export function Result({ label, value, warn = false }: ResultProps) {
  return (
    <div className="flex justify-between items-center bg-stone-700/50 rounded px-3 py-2 mt-2">
      <span className="text-stone-400 text-sm">{label}</span>
      <span className={`font-bold ${warn ? 'text-red-400' : 'text-amber-400'}`}>
        {value}
      </span>
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  warn?: boolean;
}

export function StatCard({ label, value, warn = false }: StatCardProps) {
  return (
    <div
      className={`bg-stone-800 rounded-lg p-3 ${
        warn ? 'border border-red-500/50' : ''
      }`}
    >
      <div className="text-xs text-stone-500">{label}</div>
      <div
        className={`text-xl font-bold ${warn ? 'text-red-400' : 'text-amber-400'}`}
      >
        {value}
      </div>
    </div>
  );
}
