"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const ITEMS = [
  { href: "/platform/purchases", label: "購入申請" },
  { href: "/platform/payments", label: "入金管理" },
  { href: "/platform/receipts", label: "領収書一覧" },
  { href: "/platform/transfers", label: "ライセンス移管" },
  { href: "/platform/entitlements", label: "権利一覧" },
  { href: "/platform/billing-settings", label: "請求元設定" },
]

export default function PlatformAdminNav() {
  const pathname = usePathname()

  return (
    <nav
      style={{
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        padding: 8,
        borderRadius: 14,
        border: "1px solid var(--border)",
        background: "var(--surface)",
      }}
    >
      {ITEMS.map((item) => {
        const active = pathname === item.href
        return (
          <Link
            key={item.href}
            href={item.href}
            style={{
              padding: "8px 12px",
              borderRadius: 999,
              textDecoration: "none",
              fontWeight: 600,
              color: active ? "#fff" : "var(--text)",
              background: active ? "var(--primary)" : "var(--surface-2)",
              border: `1px solid ${active ? "var(--primary)" : "var(--border)"}`,
            }}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
