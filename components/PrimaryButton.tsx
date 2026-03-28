"use client"

type PrimaryButtonProps = {
  children: React.ReactNode
  disabled?: boolean
  loading?: boolean
  onClick?: () => void
  hint?: string
  variant?: "default" | "onboarding"
}

export default function PrimaryButton({
  children,
  disabled,
  loading,
  onClick,
  hint,
  variant = "default",
}: PrimaryButtonProps) {
  const isDisabled = disabled || loading
  const label = loading ? "処理中..." : children

  if (variant === "onboarding") {
    return (
      <div style={{ width: "100%" }}>
        <button type="button" onClick={onClick} disabled={isDisabled} className="onboarding-cta">
          {label}
        </button>
        {isDisabled && hint ? (
          <p style={{ marginTop: 10, fontSize: 13, color: "var(--muted)", textAlign: "center" }}>{hint}</p>
        ) : null}
      </div>
    )
  }

  return (
    <div style={{ width: "100%" }}>
      <button
        type="button"
        onClick={onClick}
        disabled={isDisabled}
        style={{
          width: "100%",
          padding: "14px 20px",
          borderRadius: 12,
          border: "none",
          background: isDisabled ? "var(--surface-2)" : "var(--primary)",
          color: isDisabled ? "var(--muted)" : "var(--primary-contrast)",
          fontSize: 15,
          fontWeight: 600,
          cursor: isDisabled ? "not-allowed" : "pointer",
          boxShadow: isDisabled ? "none" : "var(--shadow-sm)",
          opacity: isDisabled ? 0.9 : 1,
          transition: "opacity 0.15s, box-shadow 0.15s",
        }}
      >
        {label}
      </button>
      {isDisabled && hint ? (
        <p style={{ marginTop: 8, fontSize: 12, color: "var(--muted)", textAlign: "center" }}>{hint}</p>
      ) : null}
    </div>
  )
}
