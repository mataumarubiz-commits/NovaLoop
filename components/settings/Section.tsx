"use client"

export default function Section({
  title,
  children,
  action,
  style,
}: {
  title: string
  children: React.ReactNode
  action?: React.ReactNode
  style?: React.CSSProperties
}) {
  return (
    <section style={{ marginBottom: 32, ...style }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 10,
        }}
      >
        <h2
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: "var(--text)",
            margin: 0,
          }}
        >
          {title}
        </h2>
        {action}
      </div>
      <div
        style={{
          borderBottom: "1px solid var(--border)",
          marginBottom: 16,
          opacity: 0.6,
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {children}
      </div>
    </section>
  )
}
