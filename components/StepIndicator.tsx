"use client"

import { Fragment } from "react"

type StepIndicatorProps = {
  current: number
  total: number
}

export default function StepIndicator({ current, total }: StepIndicatorProps) {
  const safeTotal = Math.max(total, 1)

  return (
    <div
      className="onboarding-progress"
      role="progressbar"
      aria-valuenow={current}
      aria-valuemin={1}
      aria-valuemax={safeTotal}
      aria-label={`ステップ ${current} / ${safeTotal}`}
    >
      <div className="onboarding-progress-dots" aria-hidden="true">
        {Array.from({ length: safeTotal }, (_, index) => {
          const step = index + 1
          const state = step < current ? "done" : step === current ? "current" : "pending"
          const connectorState = step < current ? "done" : "pending"

          return (
            <Fragment key={step}>
              <span className={`onboarding-progress-dot ${state}`}>
                {state === "done" ? <span className="onboarding-progress-check">✓</span> : null}
              </span>
              {step < safeTotal ? <span className={`onboarding-progress-connector ${connectorState}`} /> : null}
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}
