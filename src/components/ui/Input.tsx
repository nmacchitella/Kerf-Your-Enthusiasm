'use client';

import { InputHTMLAttributes, SelectHTMLAttributes, ReactNode } from 'react';

const baseInputClass =
  'bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-sm text-slate-800 focus:border-slate-400 focus:bg-white outline-none transition-colors';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function Input({ label, className = '', ...props }: InputProps) {
  if (label) {
    return (
      <div>
        <label className="text-xs text-slate-500 block mb-1">{label}</label>
        <input className={`${baseInputClass} ${className}`} {...props} />
      </div>
    );
  }
  return <input className={`${baseInputClass} ${className}`} {...props} />;
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  children: ReactNode;
}

export function Select({ label, className = '', children, ...props }: SelectProps) {
  if (label) {
    return (
      <div>
        <label className="text-xs text-slate-500 block mb-1">{label}</label>
        <select className={`${baseInputClass} ${className}`} {...props}>
          {children}
        </select>
      </div>
    );
  }
  return (
    <select className={`${baseInputClass} ${className}`} {...props}>
      {children}
    </select>
  );
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...props
}: ButtonProps) {
  const variants = {
    primary: 'bg-slate-700 hover:bg-slate-600 text-white',
    secondary: 'bg-slate-100 hover:bg-slate-200 text-slate-700',
    danger: 'bg-red-600 hover:bg-red-500 text-white',
    ghost: 'text-slate-500 hover:text-slate-700',
  };

  const sizes = {
    sm: 'px-2 py-1 text-xs',
    md: 'px-3 py-1.5 text-sm',
    lg: 'px-4 py-2 text-sm',
  };

  return (
    <button
      className={`rounded transition-colors ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
