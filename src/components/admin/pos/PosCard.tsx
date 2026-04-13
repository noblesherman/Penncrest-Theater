import { ReactNode } from 'react';
import { motion } from 'motion/react';

interface PosCardProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  className?: string;
  highlighted?: boolean;
}

export function PosCard({ children, title, subtitle, className = '', highlighted = false }: PosCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`rounded-2xl border-2 p-6 transition-all ${
        highlighted ? 'border-blue-300 bg-blue-50 shadow-lg shadow-blue-100' : 'border-stone-200 bg-white shadow-sm hover:shadow-md'
      } ${className}`}
    >
      {(title || subtitle) && (
        <div className="mb-4">
          {title && <h3 className="text-lg font-bold text-stone-900">{title}</h3>}
          {subtitle && <p className="text-sm text-stone-600 mt-1">{subtitle}</p>}
        </div>
      )}
      {children}
    </motion.div>
  );
}
