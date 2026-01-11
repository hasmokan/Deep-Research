'use client';

/**
 * Loading state component with skeleton loading and progress steps
 */

import { FileSearch, Brain, FileText, CheckCircle2 } from 'lucide-react';

interface LoadingStep {
  id: string;
  label: string;
  icon: React.ReactNode;
  status: 'pending' | 'active' | 'completed';
}

const loadingSteps: LoadingStep[] = [
  {
    id: 'search',
    label: 'Searching documents',
    icon: <FileSearch className="h-4 w-4" />,
    status: 'completed',
  },
  {
    id: 'analyze',
    label: 'Analyzing content',
    icon: <Brain className="h-4 w-4" />,
    status: 'active',
  },
  {
    id: 'report',
    label: 'Generating report',
    icon: <FileText className="h-4 w-4" />,
    status: 'pending',
  },
];

export function LoadingState() {
  return (
    <div className="glass-strong rounded-2xl p-8">
      <div className="space-y-8">
        {/* Header */}
        <div className="text-center space-y-2">
          <h3 className="text-lg font-semibold text-foreground">
            Processing Your Research
          </h3>
          <p className="text-sm text-muted-foreground">
            AI is analyzing documents and generating insights
          </p>
        </div>

        {/* Progress Steps */}
        <div className="flex justify-center">
          <div className="flex items-center gap-3">
            {loadingSteps.map((step, index) => (
              <div key={step.id} className="flex items-center">
                {/* Step */}
                <div className="flex items-center gap-2">
                  <div
                    className={`
                      flex h-10 w-10 items-center justify-center rounded-xl
                      transition-smooth
                      ${step.status === 'completed'
                        ? 'bg-green-500/10 text-green-500'
                        : step.status === 'active'
                        ? 'bg-primary/10 text-primary animate-pulse-ring'
                        : 'bg-muted text-muted-foreground'
                      }
                    `}
                  >
                    {step.status === 'completed' ? (
                      <CheckCircle2 className="h-5 w-5" />
                    ) : (
                      step.icon
                    )}
                  </div>
                  <span
                    className={`
                      text-sm font-medium hidden md:block
                      ${step.status === 'completed'
                        ? 'text-green-500'
                        : step.status === 'active'
                        ? 'text-primary'
                        : 'text-muted-foreground'
                      }
                    `}
                  >
                    {step.label}
                  </span>
                </div>

                {/* Connector */}
                {index < loadingSteps.length - 1 && (
                  <div
                    className={`
                      w-8 md:w-12 h-0.5 mx-2
                      ${step.status === 'completed'
                        ? 'bg-green-500'
                        : 'bg-border'
                      }
                    `}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Skeleton Preview */}
        <div className="space-y-4">
          <div className="skeleton h-4 w-3/4 rounded-lg" />
          <div className="skeleton h-4 w-full rounded-lg" />
          <div className="skeleton h-4 w-5/6 rounded-lg" />
          <div className="skeleton h-4 w-2/3 rounded-lg" />
        </div>

        {/* Hint */}
        <p className="text-xs text-muted-foreground text-center">
          This may take a few moments depending on the complexity of your query
        </p>
      </div>
    </div>
  );
}
