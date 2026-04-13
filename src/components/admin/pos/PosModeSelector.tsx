type PosModeSelectorProps = {
  value: 'DOOR' | 'COMP';
  onChange: (next: 'DOOR' | 'COMP') => void;
};

export function PosModeSelector(props: PosModeSelectorProps) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-red-600">Sale Type</p>
      <div className="grid grid-cols-2 gap-3">
        {([
          { id: 'DOOR' as const, title: 'Door Sale', subtitle: 'Cash or card at box office' },
          { id: 'COMP' as const, title: 'Comp', subtitle: 'Complimentary ticket assignment' }
        ]).map((item) => {
          const selected = item.id === props.value;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => props.onChange(item.id)}
              className={[
                'rounded-2xl border p-4 text-left transition',
                selected
                  ? 'border-red-200 bg-red-50 text-red-800'
                  : 'border-stone-200 bg-white text-stone-800 hover:border-red-200 hover:bg-red-50/40'
              ].join(' ')}
            >
              <p className="text-base font-bold">{item.title}</p>
              <p className={`mt-1 text-xs ${selected ? 'text-red-700' : 'text-stone-500'}`}>{item.subtitle}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
