import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
      <h1 className="text-6xl font-bold text-slate-300 mb-4">404</h1>
      <h2 className="text-xl font-medium text-slate-700 mb-2">Page Not Found</h2>
      <p className="text-slate-500 mb-6 max-w-md">
        Looks like this cut missed the mark. The page you&apos;re looking for doesn&apos;t exist.
      </p>
      <Link
        href="/cut-list"
        className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm font-medium transition-colors"
      >
        Back to Cut List
      </Link>
    </div>
  );
}
