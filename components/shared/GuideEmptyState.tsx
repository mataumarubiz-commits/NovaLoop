"use client"

import Link from "next/link"

type Props = {
  title: string
  description: string
  primaryHref: string
  primaryLabel: string
  helpHref?: string
  helpLabel?: string
}

export default function GuideEmptyState({
  title,
  description,
  primaryHref,
  primaryLabel,
  helpHref,
  helpLabel = "使い方を見る",
}: Props) {
  return (
    <section
      style={{
        border: "1px dashed rgba(167, 139, 250, 0.45)",
        borderRadius: 16,
        padding: 18,
        background: "linear-gradient(180deg, rgba(255,255,255,0.94), rgba(248,244,255,0.96))",
        display: "grid",
        gap: 12,
      }}
    >
      <div>
        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{title}</div>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)", lineHeight: 1.7 }}>{description}</p>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link
          href={primaryHref}
          style={{
            textDecoration: "none",
            padding: "10px 14px",
            borderRadius: 12,
            background: "var(--button-primary-bg)",
            color: "var(--primary-contrast)",
            fontWeight: 700,
            fontSize: 13,
          }}
        >
          {primaryLabel}
        </Link>
        {helpHref ? (
          <Link
            href={helpHref}
            style={{
              textDecoration: "none",
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--text)",
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            {helpLabel}
          </Link>
        ) : null}
      </div>
    </section>
  )
}
