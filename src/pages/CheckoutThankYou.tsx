import { useEffect, useMemo } from 'react';
import { Heart } from 'lucide-react';
import { motion } from 'motion/react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { buildConfirmationPath } from '../lib/orderAccess';

const REDIRECT_DELAY_MS = 2100;

export default function CheckoutThankYou() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const confirmationPath = useMemo(() => {
    const orderId = searchParams.get('orderId');
    if (!orderId) return null;
    const token = searchParams.get('token');
    return buildConfirmationPath(orderId, token);
  }, [searchParams]);

  useEffect(() => {
    if (!confirmationPath) {
      navigate('/orders/lookup', { replace: true });
      return;
    }

    const timer = window.setTimeout(() => {
      navigate(confirmationPath, { replace: true });
    }, REDIRECT_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [confirmationPath, navigate]);

  return (
    <section className="relative flex min-h-[72vh] items-center justify-center overflow-hidden bg-stone-950 px-4 py-12">
      <style>{css}</style>

      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <span className="ty-orb ty-orb-left" />
        <span className="ty-orb ty-orb-right" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="ty-card relative w-full max-w-md overflow-hidden rounded-[30px] border border-stone-200/80 bg-white/90 px-8 py-9 text-center shadow-[0_28px_80px_-28px_rgba(15,23,42,0.55)] backdrop-blur-md"
      >
        <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-red-700 via-amber-500 to-red-700" />
        <span className="ty-spotlight ty-spotlight-left" aria-hidden="true" />
        <span className="ty-spotlight ty-spotlight-right" aria-hidden="true" />

        <div className="relative mx-auto mb-5 grid h-24 w-24 place-items-center" aria-hidden="true">
          <span className="ty-heart-ring" />
          <span className="ty-heart-ring ty-heart-ring-second" />
          <motion.div
            animate={{ scale: [1, 1.12, 0.95, 1.08, 1] }}
            transition={{ duration: 1.25, times: [0, 0.2, 0.45, 0.65, 1], repeat: 1 }}
          >
            <Heart className="h-11 w-11 text-red-700" fill="currentColor" />
          </motion.div>
          <span className="ty-spark ty-spark-left" />
          <span className="ty-spark ty-spark-right" />
        </div>

        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.42 }}
          className="text-[clamp(1.7rem,3.6vw,2.2rem)] font-bold leading-none text-stone-900"
          style={{ fontFamily: 'Georgia, serif' }}
        >
          Thank you
        </motion.p>
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.24, duration: 0.42 }}
          className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-stone-500"
        >
          Loading your tickets
        </motion.p>
      </motion.div>
    </section>
  );
}

const css = `
.ty-card::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(130deg, rgba(255, 255, 255, 0.3), rgba(255, 255, 255, 0));
  pointer-events: none;
}

.ty-orb {
  position: absolute;
  border-radius: 9999px;
  filter: blur(52px);
}

.ty-orb-left {
  width: 260px;
  height: 260px;
  left: -88px;
  top: 16%;
  background: rgba(220, 38, 38, 0.26);
  animation: ty-float-left 2.1s ease-in-out infinite alternate;
}

.ty-orb-right {
  width: 300px;
  height: 300px;
  right: -100px;
  bottom: 6%;
  background: rgba(245, 158, 11, 0.2);
  animation: ty-float-right 2.2s ease-in-out infinite alternate;
}

.ty-spotlight {
  position: absolute;
  top: -120px;
  width: 140px;
  height: 240px;
  background: linear-gradient(to bottom, rgba(252, 211, 77, 0.24), rgba(252, 211, 77, 0));
  filter: blur(2px);
}

.ty-spotlight-left {
  left: 30px;
  transform: rotate(15deg);
  animation: ty-spotlight-left 1.9s ease-in-out 1;
}

.ty-spotlight-right {
  right: 30px;
  transform: rotate(-15deg);
  animation: ty-spotlight-right 1.9s ease-in-out 1;
}

.ty-heart-ring {
  position: absolute;
  inset: 0;
  border: 2px solid rgba(185, 28, 28, 0.24);
  border-radius: 9999px;
  animation: ty-ring 1.2s ease-out 2;
}

.ty-heart-ring-second {
  animation-delay: 0.22s;
}

.ty-spark {
  position: absolute;
  width: 7px;
  height: 7px;
  border-radius: 9999px;
  background: #dc2626;
  box-shadow: 0 0 0 5px rgba(220, 38, 38, 0.14);
}

.ty-spark-left {
  left: 4px;
  top: 20px;
  animation: ty-spark-left 1.15s ease-in-out 2;
}

.ty-spark-right {
  right: 4px;
  bottom: 16px;
  background: #f59e0b;
  box-shadow: 0 0 0 5px rgba(245, 158, 11, 0.14);
  animation: ty-spark-right 1.15s ease-in-out 2;
}

@keyframes ty-ring {
  0% {
    transform: scale(0.65);
    opacity: 0.7;
  }
  100% {
    transform: scale(1.24);
    opacity: 0;
  }
}

@keyframes ty-spark-left {
  0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.6; }
  50% { transform: translate(-8px, -8px) scale(1.15); opacity: 1; }
}

@keyframes ty-spark-right {
  0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.65; }
  50% { transform: translate(8px, 8px) scale(1.15); opacity: 1; }
}

@keyframes ty-float-left {
  from { transform: translateY(0) translateX(0); }
  to { transform: translateY(-12px) translateX(8px); }
}

@keyframes ty-float-right {
  from { transform: translateY(0) translateX(0); }
  to { transform: translateY(10px) translateX(-8px); }
}

@keyframes ty-spotlight-left {
  0% { opacity: 0; transform: rotate(19deg) translateX(-6px); }
  30% { opacity: 1; }
  100% { opacity: 0.35; transform: rotate(12deg) translateX(6px); }
}

@keyframes ty-spotlight-right {
  0% { opacity: 0; transform: rotate(-19deg) translateX(6px); }
  30% { opacity: 1; }
  100% { opacity: 0.35; transform: rotate(-12deg) translateX(-6px); }
}
`;
