import { forwardRef, SelectHTMLAttributes, ReactNode } from 'react';
import { motion } from 'motion/react';
import { ChevronDown } from 'lucide-react';

interface PosSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: Array<{ value: string; label: string }>;
  error?: string;
  helperText?: string;
  icon?: ReactNode;
  containerClassName?: string;
  placeholderText?: string;
}

export const PosSelect = forwardRef<HTMLSelectElement, PosSelectProps>(
  ({ label, options, error, helperText, icon, containerClassName = '', className = '', placeholderText = 'Select an option...', ...props }, ref) => {
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
          <select
            ref={ref}
            {...props}
            className={`w-full px-4 py-3 ${icon ? 'pl-11' : ''} appearance-none rounded-lg border-2 transition-all focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-stone-100 disabled:cursor-not-allowed ${
              error ? 'border-red-500 bg-red-50' : 'border-stone-200 bg-stone-50 hover:border-stone-300'
            } ${className}`}
          >
            <option value="">{placeholderText}</option>
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-stone-400 pointer-events-none" />
        </motion.div>
        {helperText && !error && <p className="mt-2 text-xs text-stone-500">{helperText}</p>}
      </div>
    );
  }
);

PosSelect.displayName = 'PosSelect';
