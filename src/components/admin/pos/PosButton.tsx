import { ReactNode, ButtonHTMLAttributes } from 'react';
import { motion } from 'motion/react';
import { LucideIcon } from 'lucide-react';

export type PosButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'success' | 'ghost';
export type PosButtonSize = 'sm' | 'md' | 'lg' | 'xl';

interface PosButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: PosButtonVariant;
  size?: PosButtonSize;
  icon?: LucideIcon | ReactNode;
  isLoading?: boolean;
  fullWidth?: boolean;
  children: ReactNode;
}

const variantClasses: Record<PosButtonVariant, string> = {
  primary: 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg hover:shadow-xl',
  secondary: 'bg-stone-200 hover:bg-stone-300 text-stone-900 hover:text-stone-950',
  outline: 'border-2 border-stone-300 hover:border-stone-400 text-stone-900 hover:bg-stone-50',
  danger: 'bg-red-600 hover:bg-red-700 text-white shadow-lg hover:shadow-xl',
  success: 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg hover:shadow-xl',
  ghost: 'text-stone-700 hover:bg-stone-100 hover:text-stone-900',
};

const sizeClasses: Record<PosButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs font-medium rounded-md',
  md: 'px-4 py-2 text-sm font-semibold rounded-lg',
  lg: 'px-5 py-3 text-base font-semibold rounded-lg',
  xl: 'px-6 py-4 text-lg font-bold rounded-xl',
};

export function PosButton({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  isLoading = false,
  fullWidth = false,
  disabled = false,
  children,
  className = '',
  ...props
}: PosButtonProps) {
  const isRenderIcon = Icon && typeof Icon === 'function';

  return (
    <motion.button
      disabled={disabled || isLoading}
      whileHover={!disabled && !isLoading ? { y: -2 } : {}}
      whileTap={!disabled && !isLoading ? { y: 0 } : {}}
      className={`inline-flex items-center justify-center gap-2 font-medium transition-all disabled:opacity-60 disabled:cursor-not-allowed ${variantClasses[variant]} ${sizeClasses[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
      {...(props as any)}
    >
      {isLoading ? (
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} className="h-5 w-5 rounded-full border-2 border-current border-t-transparent" />
      ) : isRenderIcon ? (
        <Icon className="h-5 w-5" />
      ) : Icon ? (
        Icon as ReactNode
      ) : null}
      <span>{children}</span>
    </motion.button>
  );
}
