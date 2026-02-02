import Link from 'next/link';

export default function QuickActionsWidgetPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">Mediator quick actions</h1>
      <p className="text-sm text-slate-600">
        Widget host surface for quick actions.
      </p>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <ul className="list-disc pl-5 text-sm text-slate-700">
          <li>Review approvals</li>
          <li>Verify proofs</li>
          <li>Open settlement queue</li>
        </ul>
      </div>
      <Link className="text-sm font-semibold text-lime-600" href="/">
        Return home
      </Link>
    </main>
  );
}
