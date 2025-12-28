import type { Metadata } from 'next';
import './globals.css';
import { Navigation } from '@/components/Navigation';

export const metadata: Metadata = {
  title: 'Kerfuffle - Woodworker\'s Toolkit',
  description: 'Plan projects, optimize cuts, and do shop math',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-stone-900 text-stone-100">
        <div className="max-w-4xl mx-auto p-4">
          <header className="mb-6">
            <h1 className="text-2xl font-bold text-amber-400">Kerfuffle</h1>
            <p className="text-stone-500 text-sm">Plan - Calculate - Build</p>
          </header>
          <Navigation />
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
