type LionSplashProps = {
  fading: boolean;
};

export default function LionSplash({ fading }: LionSplashProps) {
  return (
    <div className={`lion-splash${fading ? ' lion-splash--fade' : ''}`} role="presentation" aria-hidden="true">
      <div className="lion-splash__curtain">
        <div className="lion-splash__curtain-panel lion-splash__curtain-panel--left">
          {[20, 40, 60, 80].map((pct) => (
            <span key={`left-${pct}`} className="lion-splash__curtain-fold" style={{ left: `${pct}%` }} />
          ))}
          <span className="lion-splash__curtain-trim lion-splash__curtain-trim--right" />
        </div>
        <div className="lion-splash__curtain-panel lion-splash__curtain-panel--right">
          {[20, 40, 60, 80].map((pct) => (
            <span key={`right-${pct}`} className="lion-splash__curtain-fold" style={{ left: `${pct}%` }} />
          ))}
          <span className="lion-splash__curtain-trim lion-splash__curtain-trim--left" />
        </div>
        <div className="lion-splash__curtain-valance">
          <span className="lion-splash__curtain-valance-trim" />
          <div className="lion-splash__curtain-tassels">
            {Array.from({ length: 24 }).map((_, i) => (
              <span
                key={`tassel-${i}`}
                className="lion-splash__curtain-tassel"
                style={{
                  height: `${10 + (i % 5)}px`,
                  animationDelay: `${i * 0.035}s`,
                }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="lion-splash__bg-orb lion-splash__bg-orb--one" />
      <div className="lion-splash__bg-orb lion-splash__bg-orb--two" />
      <div className="lion-splash__bg-orb lion-splash__bg-orb--three" />

      <div className="lion-splash__centerpiece">
        <div className="lion-splash__halo" />
        <div className="lion-splash__mark-shell">
          <img src="/favicon.svg" alt="" className="lion-splash__mark" />
          <div className="lion-splash__shine" />
        </div>
      </div>

      <p className="lion-splash__label">Penncrest Theater</p>
      <p className="lion-splash__subtext">Setting the stage</p>
      <div className="lion-splash__loader">
        <span className="lion-splash__loader-fill" />
      </div>
    </div>
  );
}
