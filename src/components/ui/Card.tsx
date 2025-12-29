'use client';

import { ReactNode } from 'react';

interface CardProps {
  title: string;
  children: ReactNode;
  className?: string;
}

export function Card({ title, children, className = '' }: CardProps) {
  return (
    <div className={`bg-white rounded-md p-4 shadow-sm border border-slate-200 ${className}`}>
      <h3 className="text-slate-700 text-sm font-medium mb-3">{title}</h3>
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
    <div className="flex justify-between items-center py-1.5 mt-1">
      <span className="text-slate-500 text-sm">{label}</span>
      <span className={`font-medium ${warn ? 'text-red-600' : 'text-slate-700'}`}>
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
      className={`bg-white rounded-md p-3 shadow-sm border ${
        warn ? 'border-red-300' : 'border-slate-200'
      }`}
    >
      <div className="text-xs text-slate-500">{label}</div>
      <div
        className={`text-lg font-medium ${warn ? 'text-red-600' : 'text-slate-700'}`}
      >
        {value}
      </div>
    </div>
  );
}
