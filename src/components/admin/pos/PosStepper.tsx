import { ReactNode } from 'react';
import { motion } from 'motion/react';
import { Check, ChevronRight } from 'lucide-react';

export type StepConfig = {
  id: string;
  label: string;
  title?: string;
  description?: string;
};

export interface PosStepperProps {
  steps: StepConfig[];
  currentStepId: string;
  completedStepIds?: string[];
  onStepClick?: (stepId: string) => void;
}

export function PosStepper({ steps, currentStepId, completedStepIds = [], onStepClick }: PosStepperProps) {
  const currentIndex = steps.findIndex((s) => s.id === currentStepId);

  return (
    <div className="flex w-full items-center justify-between">
      {steps.map((step, index) => {
        const isCompleted = completedStepIds.includes(step.id);
        const isCurrent = step.id === currentStepId;
        const isNext = index === currentIndex + 1;

        return (
          <div key={step.id} className="flex flex-1 items-center">
            {/* Step indicator */}
            <motion.button
              onClick={() => onStepClick?.(step.id)}
              disabled={!isCompleted && !isCurrent}
              whileHover={!isCompleted && !isCurrent ? {} : { scale: 1.05 }}
              whileTap={!isCompleted && !isCurrent ? {} : { scale: 0.95 }}
              className={`relative flex h-10 w-10 items-center justify-center rounded-full font-semibold text-sm transition-all ${
                isCurrent
                  ? 'bg-blue-600 text-white ring-4 ring-blue-100'
                  : isCompleted
                    ? 'bg-emerald-600 text-white'
                    : 'bg-stone-200 text-stone-600'
              } disabled:cursor-not-allowed`}
            >
              {isCompleted ? (
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 100 }}>
                  <Check className="h-5 w-5" />
                </motion.div>
              ) : (
                <span>{index + 1}</span>
              )}
            </motion.button>

            {/* Connector line */}
            {index < steps.length - 1 && (
              <motion.div
                className="mx-1 flex-1 sm:mx-2"
                animate={{ background: isCompleted ? '#16a34a' : isNext ? '#e7e5e4' : '#d6d3d1' }}
                transition={{ duration: 0.3 }}
              >
                <div className="h-1 w-full rounded-full bg-inherit" />
              </motion.div>
            )}

            {/* Label (shown on larger screens) */}
            {index < steps.length - 1 && (
              <ChevronRight className={`mx-0.5 h-4 w-4 ${isCompleted || isCurrent ? 'text-blue-600' : 'text-stone-300'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
