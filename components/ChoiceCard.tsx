"use client"

import { useState } from "react"

type ChoiceCardProps = {
  icon: string
  title: string
  description: string
  onClick: () => void
  selected?: boolean
}

export default function ChoiceCard({ icon, title, description, onClick, selected }: ChoiceCardProps) {
  const [hover, setHover] = useState(false)
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: 20,
        borderRadius: 16,
        border: selected ? "2px solid #7c3aed" : "1px solid var(--border)",
        background: selected ? "var(--surface-2)" : hover ? "var(--surface-2)" : "var(--input-bg)",
        color: "var(--text)",
        cursor: "pointer",
        boxShadow: hover || selected ? "0 8px 24px rgba(0,0,0,0.1)" : "0 4px 14px rgba(0,0,0,0.06)",
        transform: hover || selected ? "scale(1.01)" : "scale(1)",
        transition: "transform 0.2s ease, box-shadow 0.2s ease, background 0.15s, border-color 0.15s",
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 12,
          background: "var(--surface-2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 24,
          marginBottom: 12,
        }}
      >
        {icon}
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.45 }}>{description}</div>
    </button>
  )
}
