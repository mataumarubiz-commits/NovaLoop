"use client"

import Link from "next/link"

type MenuRowProps = {
  href: string
  title: string
  description: string
  first?: boolean
  tone?: "default" | "muted" | "danger"
}

export default function MenuRow({ href, title, description, first = false, tone = "default" }: MenuRowProps) {
  const titleColor = tone === "danger" ? "var(--error-text)" : tone === "muted" ? "var(--muted)" : "var(--text)"

  return (
    <Link
      href={href}
      className="settings-menu-row settings-row"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "16px 20px",
        borderTop: first ? "none" : "1px solid var(--border)",
        textDecoration: "none",
        color: "inherit",
        transition: "background 0.15s ease, transform 0.15s ease",
      }}
    >
      <div style={{ minWidth: 0, flex: "1 1 auto" }}>
        <div style={{ fontSize: 14.5, fontWeight: 600, color: titleColor, lineHeight: 1.4 }}>{title}</div>
        <div style={{ marginTop: 4, fontSize: 13, lineHeight: 1.65, color: "var(--muted)" }}>{description}</div>
      </div>
      <div style={{ flexShrink: 0, color: "var(--muted)", fontSize: 16, lineHeight: 1 }}>&gt;</div>
    </Link>
  )
}
