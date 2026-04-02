import { CheckCircleIcon } from '@heroicons/react/20/solid'

interface StepProps {
  steps: Array<{ name: string }>;
  currentStep: number;
}

export default function Step({ steps, currentStep }: StepProps) {
  return (
    <div className="px-4 pt-6 sm:px-6 lg:px-2 w-full">
      <nav className="flex justify-start" aria-label="Progress">
        <ol role="list" className="space-y-3">
          {steps.map((step, index) => (
            <li key={step.name}>
              {index < currentStep ? (
                <div className="group">
                  <span className="flex items-start">
                    <span className="relative flex h-5 w-5 flex-shrink-0 items-center justify-center">
                      <CheckCircleIcon
                        className="h-full w-full text-blue-500"
                        aria-hidden="true"
                      />
                    </span>
                    <span className="ml-3 text-sm font-medium text-gray-500">
                      {step.name} 
                    </span>
                  </span>
                </div>
              ) : index === currentStep ? (
                <div className="flex items-start justify-start" aria-current="step">
                  <span className="relative flex h-5 w-5 flex-shrink-0 items-center justify-center" aria-hidden="true">
                    <span className="absolute h-4 w-4 rounded-full bg-blue-200" />
                    <span className="relative block h-2 w-2 rounded-full bg-blue-500 blink" />
                  </span>
                  <span className="ml-3 text-sm font-medium text-blue-500">{step.name}</span>
                </div>
              ) : (
                <div className="group">
                  <div className="flex items-start">
                    <div className="relative flex h-5 w-5 flex-shrink-0 items-center justify-center" aria-hidden="true">
                      <div className="h-2 w-2 rounded-full bg-gray-300" />
                    </div>
                    <p className="ml-3 text-sm font-medium text-gray-500">{step.name}</p>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ol>
      </nav>
    </div>
  )
}
