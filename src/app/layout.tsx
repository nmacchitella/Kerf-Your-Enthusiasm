import type { Metadata } from 'next';
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
      <body className="min-h-screen bg-slate-50 text-slate-800">
        <div className="px-4 lg:px-8 xl:px-12">
          <header className="py-4 flex items-center justify-between border-b border-slate-200">
            <div>
              <h1 className="text-lg font-medium text-slate-800 tracking-wide">Kerf-Your-Enthusiasm</h1>
              <p className="text-slate-400 text-xs">Plan - Calculate - Build</p>
            </div>
            <Navigation />
          </header>
          <main className="pb-8">{children}</main>
        </div>
        <MigrationPrompt />
      </body>
    </html>
  );
}
