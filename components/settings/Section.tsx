"use client"

type SectionProps = {
  title: string
  description?: string
  action?: React.ReactNode
  children: React.ReactNode
}

export default function Section({ title, description, action, children }: SectionProps) {
  return (
    <section style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.01em" }}>{title}</h2>
          {description ? <p style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.7, color: "var(--muted)" }}>{description}</p> : null}
        </div>
        {action ? <div style={{ flexShrink: 0 }}>{action}</div> : null}
      </div>
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 16,
          background: "var(--surface)",
          boxShadow: "var(--shadow-sm)",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "grid" }}>{children}</div>
      </div>
    </section>
  )
}
