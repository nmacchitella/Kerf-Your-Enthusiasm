'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from '@/lib/auth-client';
import { UserMenu } from '@/components/auth/UserMenu';

const publicNavItems = [
  { href: '/cut-list', label: 'Cut List' },
  { href: '/calculators', label: 'Calculators' },
];

const authNavItems = [
  { href: '/dashboard', label: 'My Projects' },
];

export function Navigation() {
  const pathname = usePathname();
  const { data: session, isPending } = useSession();

  const navItems = session ? [...authNavItems, ...publicNavItems] : publicNavItems;

  return (
    <nav className="flex items-center justify-between">
      <div className="flex gap-1">
        {navItems.map(({ href, label }) => {
          const isActive =
            pathname === href ||
            (pathname === '/' && href === '/cut-list') ||
            (pathname.startsWith('/projects') && href === '/dashboard');
          return (
            <Link
              key={href}
              href={href}
              className={`px-3 py-1.5 rounded text-sm transition-colors ${
                isActive
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
              }`}
            >
              {label}
            </Link>
          );
        })}
      </div>

      <div className="ml-4">
        {isPending ? (
          <div className="w-8 h-8 rounded-full bg-slate-200 animate-pulse" />
        ) : session ? (
          <UserMenu />
        ) : (
          <Link
            href="/login"
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Sign in
          </Link>
        )}
      </div>
    </nav>
  );
}
