import Link from 'next/link';

export default function SharePage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const title = typeof searchParams?.title === 'string' ? searchParams?.title : '';
  const text = typeof searchParams?.text === 'string' ? searchParams?.text : '';
  const url = typeof searchParams?.url === 'string' ? searchParams?.url : '';

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">Shared with Mediator</h1>
      <p className="text-sm text-slate-600">
        This screen confirms content shared into the app.
      </p>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <dl className="grid gap-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Title</dt>
            <dd className="text-sm text-slate-900">{title || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Text</dt>
            <dd className="text-sm text-slate-900">{text || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">URL</dt>
            <dd className="text-sm text-slate-900">{url || '—'}</dd>
          </div>
        </dl>
      </div>
      <Link className="text-sm font-semibold text-lime-600" href="/">
        Return home
      </Link>
    </main>
  );
}
