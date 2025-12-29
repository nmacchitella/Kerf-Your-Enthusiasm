import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { Navigation } from '@/components/Navigation';
import { MigrationPrompt } from '@/components/migration/MigrationPrompt';

export const metadata: Metadata = {
  title: 'Kerf-Your-Enthusiasm - Woodworker\'s Toolkit',
  description: 'Plan projects, optimize cuts, and do shop math',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-800 flex flex-col">
        <div className="flex-1 px-4 lg:px-8 xl:px-12">
          <header className="py-4 flex items-center justify-between border-b border-slate-200">
            <div>
              <h1 className="text-lg font-medium text-slate-800 tracking-wide">Kerf-Your-Enthusiasm</h1>
              <p className="text-slate-400 text-xs">Plan - Calculate - Build</p>
            </div>
            <Navigation />
          </header>
          <main className="pb-8">{children}</main>
        </div>
        <footer className="border-t border-slate-200 py-4 px-4 lg:px-8 xl:px-12">
          <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-slate-500">
            <Link href="/privacy" className="hover:text-slate-700 transition-colors">
              Privacy
            </Link>
            <span className="text-slate-300">·</span>
            <a
              href="https://github.com/nmacchitella/Kerf-Your-Enthusiasm/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-slate-700 transition-colors"
            >
              Feedback
            </a>
            <span className="text-slate-300">·</span>
            <a
              href="https://github.com/nmacchitella/Kerf-Your-Enthusiasm"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-slate-700 transition-colors"
            >
              GitHub
            </a>
          </div>
        </footer>
        <MigrationPrompt />
      </body>
    </html>
  );
}
