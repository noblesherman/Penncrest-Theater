type LionSplashProps = {
  fading: boolean;
};

export default function LionSplash({ fading }: LionSplashProps) {
  return (
    <div className={`lion-splash${fading ? ' lion-splash--fade' : ''}`} role="presentation" aria-hidden="true">
      <div className="lion-splash__glow" />
      <div className="lion-splash__pulse-ring lion-splash__pulse-ring--outer" />
      <div className="lion-splash__pulse-ring lion-splash__pulse-ring--inner" />
      <img src="/favicon.svg" alt="" className="lion-splash__mark" />
      <p className="lion-splash__label">Penncrest Theater</p>
    </div>
  );
}
