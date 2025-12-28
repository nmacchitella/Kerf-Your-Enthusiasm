'use client';

import { InputHTMLAttributes, SelectHTMLAttributes, ReactNode } from 'react';

const baseInputClass =
  'bg-stone-800 border border-stone-700 rounded px-2 py-1.5 text-sm focus:border-amber-500 outline-none';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function Input({ label, className = '', ...props }: InputProps) {
  if (label) {
    return (
      <div>
        <label className="text-xs text-stone-500 block mb-1">{label}</label>
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
        <label className="text-xs text-stone-500 block mb-1">{label}</label>
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
    primary: 'bg-amber-600 hover:bg-amber-500 text-stone-900 font-semibold',
    secondary: 'bg-stone-700 hover:bg-stone-600 text-stone-200',
    danger: 'bg-red-600 hover:bg-red-500 text-white',
    ghost: 'text-stone-400 hover:text-stone-200',
  };

  const sizes = {
    sm: 'px-2 py-1 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-2 text-base',
  };

  return (
    <button
      className={`rounded transition ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
