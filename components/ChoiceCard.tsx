"use client"

import { useState } from "react"

type ChoiceCardProps = {
  icon: React.ReactNode
  title: string
  description: string
  onClick: () => void
  selected?: boolean
  className?: string
}

export default function ChoiceCard({ icon, title, description, onClick, selected, className }: ChoiceCardProps) {
  const [hover, setHover] = useState(false)
  const active = hover || selected

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={className ? `onboarding-choice-card ${className}` : "onboarding-choice-card"}
      data-active={active ? "true" : "false"}
    >
      <span className="onboarding-choice-card-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="onboarding-choice-card-copy">
        <span className="onboarding-choice-card-title">{title}</span>
        <span className="onboarding-choice-card-description">{description}</span>
      </span>
    </button>
  )
}
