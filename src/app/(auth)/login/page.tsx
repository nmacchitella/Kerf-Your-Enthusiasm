'use client';

import { useSearchParams } from 'next/navigation';
import { LoginButton } from '@/components/auth/LoginButton';
import { Suspense } from 'react';

function LoginContent() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/dashboard';

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-full max-w-md p-8 bg-white rounded-xl shadow-sm border border-slate-200">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-slate-900">
            Welcome to Kerf-Your-Enthusiasm
          </h1>
          <p className="text-slate-600 mt-2">
            Sign in to save your projects and tools
          </p>
        </div>

        <div className="space-y-4">
          <LoginButton
            callbackUrl={callbackUrl}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors text-sm font-medium text-slate-700"
          />
        </div>

        <p className="text-center text-sm text-slate-500 mt-6">
          You can still use the calculators and cut list optimizer without signing in.
          Sign in to save your projects across devices.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-slate-50">Loading...</div>}>
      <LoginContent />
    </Suspense>
  );
}
