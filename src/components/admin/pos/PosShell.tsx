import type { ReactNode } from 'react';

type PosShellProps = {
  header: ReactNode;
  left: ReactNode;
  right: ReactNode;
};

export function PosShell(props: PosShellProps) {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#1f2937_0%,#0f172a_42%,#020617_100%)] text-slate-100">
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-4 p-3 sm:p-4 lg:h-screen lg:p-6">
        <div className="flex-shrink-0">{props.header}</div>
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_460px]">
          <section className="min-h-0 rounded-3xl border border-slate-700/70 bg-slate-950/70 p-4 shadow-2xl shadow-black/30 ring-1 ring-white/5 sm:p-5">
            {props.left}
          </section>
          <aside className="min-h-0 rounded-3xl border border-slate-700/70 bg-slate-950/85 p-4 shadow-2xl shadow-black/40 ring-1 ring-white/10 sm:p-5">
            {props.right}
          </aside>
        </div>
      </div>
    </div>
  );
}
