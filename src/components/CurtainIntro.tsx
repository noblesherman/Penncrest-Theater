import { useEffect, useState, type ReactNode } from 'react';

type CurtainIntroProps = {
  logoSrc?: string;
  curtainDuration?: number;
  logoHold?: number;
  fadeDuration?: number;
  children: ReactNode;
};

export default function CurtainIntro({
  logoSrc = '/favicon.svg',
  curtainDuration = 1200,
  logoHold = 900,
  fadeDuration = 600,
  children,
}: CurtainIntroProps) {
  const [phase, setPhase] = useState<'curtain' | 'logo' | 'fading' | 'done'>('curtain');

  useEffect(() => {
    const t1 = window.setTimeout(() => setPhase('logo'), curtainDuration);
    const t2 = window.setTimeout(() => setPhase('fading'), curtainDuration + logoHold);
    const t3 = window.setTimeout(() => setPhase('done'), curtainDuration + logoHold + fadeDuration);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [curtainDuration, logoHold, fadeDuration]);

  return (
    <>
      <div
        style={{
          opacity: phase === 'done' ? 1 : 0,
          transition: phase === 'fading' || phase === 'done' ? `opacity ${fadeDuration}ms ease` : 'none',
          pointerEvents: phase === 'done' ? 'auto' : 'none',
        }}
      >
        {children}
      </div>

      {phase !== 'done' && (
        <div
          aria-hidden
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: phase === 'logo' || phase === 'fading' ? 1 : 0,
              transition: `opacity ${curtainDuration * 0.4}ms ease`,
            }}
          >
            <img
              src={logoSrc}
              alt="Penncrest Theater"
              style={{
                width: 140,
                height: 140,
                objectFit: 'contain',
                opacity: phase === 'logo' || phase === 'fading' ? 1 : 0,
                transform: phase === 'logo' || phase === 'fading' ? 'scale(1)' : 'scale(0.88)',
                transition: `opacity ${curtainDuration * 0.5}ms ease, transform ${curtainDuration * 0.5}ms ease`,
              }}
            />
          </div>

          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              bottom: 0,
              width: '50%',
              background: 'linear-gradient(to right, #6b0000, #8b1a1a)',
              transform: phase === 'curtain' ? 'translateX(0)' : 'translateX(-100%)',
              transition: `transform ${curtainDuration}ms cubic-bezier(0.76, 0, 0.24, 1)`,
              boxShadow: 'inset -8px 0 24px rgba(0,0,0,0.3)',
            }}
          >
            {[15, 30, 45, 60, 75].map((pct) => (
              <div
                key={pct}
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: `${pct}%`,
                  width: 1,
                  background: 'rgba(0,0,0,0.15)',
                }}
              />
            ))}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: 6,
                background: 'linear-gradient(90deg, #c4922a, #e8b84b, #c4922a)',
              }}
            />
          </div>

          <div
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              width: '50%',
              background: 'linear-gradient(to left, #6b0000, #8b1a1a)',
              transform: phase === 'curtain' ? 'translateX(0)' : 'translateX(100%)',
              transition: `transform ${curtainDuration}ms cubic-bezier(0.76, 0, 0.24, 1)`,
              boxShadow: 'inset 8px 0 24px rgba(0,0,0,0.3)',
            }}
          >
            {[25, 40, 55, 70, 85].map((pct) => (
              <div
                key={pct}
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: `${pct}%`,
                  width: 1,
                  background: 'rgba(0,0,0,0.15)',
                }}
              />
            ))}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: 6,
                background: 'linear-gradient(90deg, #c4922a, #e8b84b, #c4922a)',
              }}
            />
          </div>

          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: 3,
              background: 'linear-gradient(90deg, transparent, #e8b84b, #c4922a, #e8b84b, transparent)',
              zIndex: 10,
            }}
          />
        </div>
      )}
    </>
  );
}
