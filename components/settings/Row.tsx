"use client"

type RowProps = {
  title: string
  description?: string
  right: React.ReactNode
  tone?: "default" | "danger"
  first?: boolean
  style?: React.CSSProperties
}

export default function Row({ title, description, right, tone = "default", first = false, style }: RowProps) {
  const textColor = tone === "danger" ? "var(--error-text)" : "var(--text)"

  return (
    <div
      className="settings-row"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "16px 20px",
        borderTop: first ? "none" : "1px solid var(--border)",
        background: "transparent",
        transition: "background 0.15s ease",
        ...style,
      }}
    >
      <div style={{ minWidth: 0, flex: "1 1 auto" }}>
        <div style={{ fontSize: 14.5, fontWeight: 600, color: textColor, lineHeight: 1.4 }}>{title}</div>
        {description ? (
          <div style={{ marginTop: 4, fontSize: 13, lineHeight: 1.65, color: "var(--muted)" }}>
            {description}
          </div>
        ) : null}
      </div>
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 10 }}>{right}</div>
    </div>
  )
}
