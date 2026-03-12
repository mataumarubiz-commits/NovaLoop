"use client"

type StepIndicatorProps = {
  current: number
  total: number
}

export default function StepIndicator({ current, total }: StepIndicatorProps) {
  return (
    <div className="onboarding-progress" role="progressbar" aria-valuenow={current} aria-valuemin={1} aria-valuemax={total} aria-label={`ステップ ${current} / ${total}`}>
      <div className="onboarding-progress-dots">
        {Array.from({ length: total }, (_, i) => {
          const done = i + 1 < current
          const active = i + 1 === current
          const dotClass = done ? "done" : active ? "current" : "pending"
          return (
            <div
              key={i}
              className={`onboarding-progress-dot ${dotClass}`}
              aria-hidden
            />
          )
        })}
      </div>
    </div>
  )
}
