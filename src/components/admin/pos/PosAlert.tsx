import { ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertCircle, CheckCircle2, InfoIcon, AlertTriangle, X } from 'lucide-react';

export type PosAlertVariant = 'info' | 'success' | 'warning' | 'error';

interface PosAlertProps {
  variant?: PosAlertVariant;
  title?: string;
  message: ReactNode;
  onDismiss?: () => void;
  dismissible?: boolean;
}

const variantConfig: Record<
  PosAlertVariant,
  { bgColor: string; borderColor: string; textColor: string; icon: ReactNode }
> = {
  info: {
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    textColor: 'text-blue-900',
    icon: <InfoIcon className="h-5 w-5 text-blue-600" />,
  },
  success: {
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-200',
    textColor: 'text-emerald-900',
    icon: <CheckCircle2 className="h-5 w-5 text-emerald-600" />,
  },
  warning: {
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
    textColor: 'text-amber-900',
    icon: <AlertTriangle className="h-5 w-5 text-amber-600" />,
  },
  error: {
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    textColor: 'text-red-900',
    icon: <AlertCircle className="h-5 w-5 text-red-600" />,
  },
};

export function PosAlert({ variant = 'info', title, message, onDismiss, dismissible = false }: PosAlertProps) {
  const config = variantConfig[variant];

  return (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
          className={`flex items-start gap-3 rounded-lg border-2 ${config.borderColor} ${config.bgColor} p-4`}
        >
          {config.icon}
          <div className="flex-1 min-w-0">
            {title && <h4 className={`font-semibold ${config.textColor}`}>{title}</h4>}
            <p className={`${title ? 'mt-1 text-sm' : 'text-sm'} ${config.textColor}`}>{message}</p>
          </div>
          {dismissible && (
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={onDismiss}
              className={`flex-shrink-0 rounded-md p-1 hover:bg-black hover:bg-opacity-10 transition-colors`}
            >
              <X className="h-4 w-4" />
            </motion.button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
