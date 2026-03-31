"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import type { CSSProperties, ReactNode } from "react"

const shellStyle: CSSProperties = {
  minHeight: "100vh",
  background: "var(--bg-grad)",
  padding: "28px 24px 44px",
}

const cardStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 16,
  background: "var(--surface)",
  padding: 16,
  boxShadow: "var(--shadow-lg)",
}

const ROUTES = [
  { href: "/projects", label: "案件一覧" },
  { href: "/timeline", label: "ガント" },
  { href: "/calendar", label: "カレンダー" },
  { href: "/materials", label: "素材" },
  { href: "/changes", label: "変更" },
  { href: "/finance-lite", label: "収支" },
  { href: "/exceptions", label: "例外" },
] as const

export function ProjectShell({
  title,
  description,
  children,
  action,
}: {
  title: string
  description: string
  children: ReactNode
  action?: ReactNode
}) {
  const pathname = usePathname()

  return (
    <div style={shellStyle}>
      <div style={{ display: "grid", gap: 16, maxWidth: 1440, margin: "0 auto" }}>
        <header style={{ ...cardStyle, display: "grid", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "start" }}>
            <div>
              <div style={{ display: "flex", gap: 8, fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
                <Link href="/home" style={{ color: "var(--primary)", textDecoration: "none", fontWeight: 700 }}>
                  Home
                </Link>
                <span>/</span>
                <span>案件管理レイヤー</span>
              </div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.02em" }}>{title}</h1>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>{description}</p>
            </div>
            {action ?? null}
          </div>

          <nav className="nav-scroll-hide" style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border)", margin: "0 -16px", padding: "0 16px", overflowX: "auto", WebkitOverflowScrolling: "touch" as const }}>
            {ROUTES.map((route) => {
              const active = pathname === route.href || pathname?.startsWith(`${route.href}/`)
              return (
                <Link
                  key={route.href}
                  href={route.href}
                  style={{
                    padding: "10px 16px",
                    borderBottom: active ? "2px solid var(--primary)" : "2px solid transparent",
                    color: active ? "var(--text)" : "var(--muted)",
                    textDecoration: "none",
                    fontSize: 13,
                    fontWeight: active ? 700 : 500,
                    whiteSpace: "nowrap",
                    transition: "color 0.15s, border-color 0.15s",
                  }}
                >
                  {route.label}
                </Link>
              )
            })}
            <Link
              href="/contents"
              style={{
                padding: "10px 16px",
                marginLeft: "auto",
                borderBottom: "2px solid transparent",
                color: "var(--muted)",
                textDecoration: "none",
                fontSize: 13,
                fontWeight: 500,
                whiteSpace: "nowrap",
              }}
            >
              制作シートへ &rarr;
            </Link>
          </nav>
        </header>

        {children}
      </div>
    </div>
  )
}

export function ProjectInfoCard({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: string
}) {
  return (
    <div style={{ ...cardStyle, padding: 14 }}>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent ?? "var(--text)" }}>{value}</div>
    </div>
  )
}

export function ProjectSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section style={cardStyle}>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>{title}</h2>
        {description ? <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--muted)", lineHeight: 1.7 }}>{description}</p> : null}
      </div>
      {children}
    </section>
  )
}
