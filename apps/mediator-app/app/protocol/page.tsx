import Link from 'next/link';

export default async function ProtocolPage({
  searchParams,
}: {
  searchParams?:
    | Record<string, string | string[] | undefined>
    | Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await Promise.resolve(searchParams ?? {});
  const url = typeof resolvedSearchParams.url === 'string' ? resolvedSearchParams.url : '';

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">Protocol launch</h1>
      <p className="text-sm text-slate-600">
        Protocol link received by the Mediator app.
      </p>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <dt className="text-xs uppercase tracking-wide text-slate-500">URL</dt>
        <dd className="text-sm text-slate-900 break-all">{url || '—'}</dd>
      </div>
      <Link className="text-sm font-semibold text-lime-600" href="/">
        Return home
      </Link>
    </main>
  );
}
