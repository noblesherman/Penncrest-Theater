import { ReactNode, forwardRef, InputHTMLAttributes } from 'react';
import { motion } from 'motion/react';
import { AlertCircle } from 'lucide-react';

interface PosInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  icon?: ReactNode;
  containerClassName?: string;
}

export const PosInput = forwardRef<HTMLInputElement, PosInputProps>(
  ({ label, error, helperText, icon, containerClassName = '', className = '', ...props }, ref) => {
    return (
      <div className={containerClassName}>
        {label && (
          <label className="block text-sm font-semibold text-stone-700 mb-2">
            {label}
            {props.required && <span className="text-red-500 ml-1">*</span>}
          </label>
        )}
        <motion.div
          className="relative"
          animate={error ? { x: [0, -2, 2, -2, 0] } : {}}
          transition={error ? { duration: 0.3 } : {}}
        >
          {icon && <div className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500 flex items-center">{icon}</div>}
          <input
            ref={ref}
            {...props}
            className={`w-full px-4 py-3 ${icon ? 'pl-11' : ''} rounded-lg border-2 transition-all focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-stone-100 disabled:cursor-not-allowed ${
              error ? 'border-red-500 bg-red-50' : 'border-stone-200 bg-stone-50 hover:border-stone-300'
            } ${className}`}
          />
        </motion.div>
        {error && (
          <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} className="mt-2 flex items-center gap-1 text-sm text-red-600">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span>{error}</span>
          </motion.div>
        )}
        {helperText && !error && <p className="mt-2 text-xs text-stone-500">{helperText}</p>}
      </div>
    );
  }
);

PosInput.displayName = 'PosInput';
