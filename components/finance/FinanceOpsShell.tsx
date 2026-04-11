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

const ROUTES: Array<{ href: string; label: string; childPaths?: string[] }> = [
  { href: "/close", label: "締め" },
  { href: "/billing", label: "請求", childPaths: ["/invoices"] },
  { href: "/expenses", label: "経費" },
  { href: "/profitability", label: "粗利" },
  { href: "/vendors", label: "外注" },
  { href: "/payouts", label: "支払" },
  { href: "/documents", label: "保管" },
]

function isActive(pathname: string | null, route: { href: string; childPaths?: string[] }) {
  if (!pathname) return false
  if (pathname === route.href || pathname.startsWith(`${route.href}/`)) return true
  return (route.childPaths ?? []).some((child) => pathname === child || pathname.startsWith(`${child}/`))
}

export function FinanceOpsShell({
  title,
  description,
  action,
  children,
}: {
  title: string
  description: string
  action?: ReactNode
  children: ReactNode
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
                <span>月次締めオペレーション</span>
              </div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.02em" }}>{title}</h1>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>{description}</p>
            </div>
            {action ?? null}
          </div>

          <nav
            className="nav-scroll-hide"
            style={{
              display: "flex",
              gap: 0,
              borderBottom: "1px solid var(--border)",
              margin: "0 -16px",
              padding: "0 16px",
              overflowX: "auto",
              WebkitOverflowScrolling: "touch" as const,
            }}
          >
            {ROUTES.map((route) => {
              const active = isActive(pathname, route)
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
          </nav>
        </header>

        {children}
      </div>
    </div>
  )
}
