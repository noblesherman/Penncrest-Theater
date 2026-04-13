import type { ReactNode } from 'react';

type PosShellProps = {
  header: ReactNode;
  left: ReactNode;
  right: ReactNode;
};

export function PosShell(props: PosShellProps) {
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-4 p-3 sm:p-4 lg:h-screen lg:p-6">
        <div className="flex-shrink-0">{props.header}</div>
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_460px]">
          <section className="min-h-0 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5">
            {props.left}
          </section>
          <aside className="min-h-0 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5">
            {props.right}
          </aside>
        </div>
      </div>
    </div>
  );
}
