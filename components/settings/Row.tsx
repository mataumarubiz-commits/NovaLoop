"use client"

type RowProps = {
  title: string
  description?: string
  right: React.ReactNode
  style?: React.CSSProperties
}

export default function Row({ title, description, right, style }: RowProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
        minHeight: 44,
        ...style,
      }}
    >
      <div style={{ flex: "1 1 200px", minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>
          {title}
        </div>
        {description && (
          <div
            style={{
              fontSize: 13,
              color: "var(--muted)",
              marginTop: 4,
              lineHeight: 1.45,
            }}
          >
            {description}
          </div>
        )}
      </div>
      <div style={{ flexShrink: 0 }}>{right}</div>
    </div>
  )
}
