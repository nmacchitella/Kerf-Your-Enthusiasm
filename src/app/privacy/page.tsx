export default function PrivacyPage() {
  return (
    <div className="max-w-2xl mx-auto py-12 px-4">
      <h1 className="text-2xl font-bold text-slate-800 mb-6">Privacy Policy</h1>

      <div className="prose prose-slate prose-sm">
        <p className="text-slate-600 mb-4">
          Last updated: December 2024
        </p>

        <h2 className="text-lg font-semibold text-slate-700 mt-6 mb-3">What we collect</h2>
        <p className="text-slate-600 mb-4">
          When you sign in with Google, we receive your name, email address, and profile picture.
          We store this information to identify your account and display your name in the app.
        </p>

        <h2 className="text-lg font-semibold text-slate-700 mt-6 mb-3">How we use your data</h2>
        <p className="text-slate-600 mb-4">
          Your data is used solely to provide the service. Your projects, tools, and settings are
          stored securely and are only accessible to you. We don&apos;t sell, share, or use your
          data for advertising.
        </p>

        <h2 className="text-lg font-semibold text-slate-700 mt-6 mb-3">Cookies & Local Storage</h2>
        <p className="text-slate-600 mb-4">
          We use cookies for authentication sessions. We also use browser local storage to save
          your calculator inputs when you&apos;re not signed in, so you don&apos;t lose your work.
        </p>

        <h2 className="text-lg font-semibold text-slate-700 mt-6 mb-3">Data retention</h2>
        <p className="text-slate-600 mb-4">
          Your account and project data are stored as long as you have an account. You can
          delete your projects at any time from your dashboard.
        </p>

        <h2 className="text-lg font-semibold text-slate-700 mt-6 mb-3">Third parties</h2>
        <p className="text-slate-600 mb-4">
          We use Google for authentication. Your data is stored on Turso (database) and
          Fly.io (hosting). We don&apos;t share your data with any other third parties.
        </p>

        <h2 className="text-lg font-semibold text-slate-700 mt-6 mb-3">Contact</h2>
        <p className="text-slate-600 mb-4">
          Questions? Open an issue on{' '}
          <a
            href="https://github.com/nmacchitella/Kerf-Your-Enthusiasm/issues"
            className="text-slate-700 underline hover:text-slate-900"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>.
        </p>
      </div>
    </div>
  );
}
