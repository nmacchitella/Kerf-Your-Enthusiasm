'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/cut-list', label: 'Cut List' },
  { href: '/tools', label: 'Tools' },
  { href: '/calculators', label: 'Calculators' },
];

export function Navigation() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-2 mb-6 border-b border-stone-700 pb-2">
      {navItems.map(({ href, label }) => {
        const isActive = pathname === href || (pathname === '/' && href === '/cut-list');
        return (
          <Link
            key={href}
            href={href}
            className={`px-4 py-2 rounded-t text-sm font-medium transition ${
              isActive
                ? 'bg-amber-600 text-stone-900'
                : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
