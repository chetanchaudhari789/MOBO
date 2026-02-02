import Link from 'next/link';

export default function NewNotePage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">New note</h1>
      <p className="text-sm text-slate-600">
        Capture quick notes for Mediator workflows.
      </p>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm text-slate-700">Notes feature placeholder.</p>
      </div>
      <Link className="text-sm font-semibold text-lime-600" href="/">
        Return home
      </Link>
    </main>
  );
}
