import { useEffect, useMemo } from 'react';
import { Heart } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { buildConfirmationPath } from '../lib/orderAccess';

const REDIRECT_DELAY_MS = 1400;

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
    <section className="flex min-h-[70vh] items-center justify-center px-4">
      <style>{css}</style>
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="thank-you-heart-shell" aria-hidden="true">
          <span className="thank-you-heart-ring" />
          <Heart className="thank-you-heart-icon" fill="currentColor" />
        </div>
        <p className="text-xl font-semibold tracking-wide text-stone-800 sm:text-2xl">Thank you</p>
      </div>
    </section>
  );
}

const css = `
.thank-you-heart-shell {
  position: relative;
  display: grid;
  place-items: center;
  width: 72px;
  height: 72px;
}

.thank-you-heart-ring {
  position: absolute;
  inset: 0;
  border: 2px solid rgba(185, 28, 28, 0.22);
  border-radius: 9999px;
  animation: thank-you-ring 1.15s ease-out both;
}

.thank-you-heart-icon {
  width: 36px;
  height: 36px;
  color: #b91c1c;
  animation: thank-you-heart 0.85s ease-in-out 2;
}

@keyframes thank-you-heart {
  0%, 100% { transform: scale(1); }
  20% { transform: scale(1.14); }
  40% { transform: scale(0.95); }
  60% { transform: scale(1.08); }
}

@keyframes thank-you-ring {
  0% {
    transform: scale(0.65);
    opacity: 0.75;
  }
  100% {
    transform: scale(1.18);
    opacity: 0;
  }
}
`;
