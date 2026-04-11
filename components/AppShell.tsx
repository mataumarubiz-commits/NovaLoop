"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import Sidebar, { SIDEBAR_WIDTH } from "./Sidebar"

const PATH_LABELS: Record<string, string> = {
  "/home": "ホーム",
  "/pages": "ページ",
  "/members": "メンバー",
  "/contents": "案件",
  "/billing": "請求",
  "/invoices": "請求書",
  "/documents": "請求書保管",
  "/notifications": "通知",
  "/onboarding": "オンボーディング",
  "/join-request": "組織参加申請",
  "/request-org": "新規組織作成",
  "/purchase-license": "ライセンス購入",
  "/pending-payment": "支払い待ち",
  "/recover-license": "ライセンス再付与",
  "/vendors": "外注",
  "/payouts": "振込",
  "/settings": "設定",
  "/settings/account": "アカウント設定",
  "/settings/license": "ライセンス設定",
  "/settings/workspace": "ワークスペース設定",
  "/platform/purchases": "Platform 購入申請",
  "/platform/payments": "Platform 入金確認",
  "/platform/transfers": "Platform 再付与",
  "/platform/billing-settings": "Platform 請求元設定",
}

const MOBILE_BREAKPOINT = 768

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [sidebarHidden, setSidebarHidden] = useState<boolean>(() => {
    if (typeof window === "undefined") return false
    try {
      return localStorage.getItem("app_shell_sidebar_hidden") === "1"
    } catch {
      return false
    }
  })

  const isRoot = pathname === "/"
  const pageLabel = PATH_LABELS[pathname] ?? (pathname.slice(1) || "アプリ")

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    check()
    window.addEventListener("resize", check)
    return () => window.removeEventListener("resize", check)
  }, [])

  useEffect(() => {
    const id = setTimeout(() => setDrawerOpen(false), 0)
    return () => clearTimeout(id)
  }, [pathname])

  useEffect(() => {
    try {
      localStorage.setItem("app_shell_sidebar_hidden", sidebarHidden ? "1" : "0")
    } catch {
      // ignore
    }
  }, [sidebarHidden])

  if (isRoot) {
    return <>{children}</>
  }

  if (isMobile) {
    return (
      <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
            background: "var(--surface)",
          }}
        >
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="メニューを開く"
            style={{
              padding: 8,
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 8,
              cursor: "pointer",
              color: "var(--text)",
              fontSize: 18,
            }}
          >
            ☰
          </button>
          <span style={{ fontSize: 16, fontWeight: 600, color: "var(--text)" }}>{pageLabel}</span>
        </header>
        <div
          role="presentation"
          style={{
            position: "fixed",
            inset: 0,
            background: drawerOpen ? "rgba(0,0,0,0.4)" : "rgba(0,0,0,0)",
            zIndex: 40,
            pointerEvents: drawerOpen ? "auto" : "none",
            transition: "background 0.25s ease",
          }}
          onClick={() => setDrawerOpen(false)}
        />
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            bottom: 0,
            width: Math.min(SIDEBAR_WIDTH, 280),
            zIndex: 50,
            boxShadow: drawerOpen ? "var(--shadow-lg)" : "none",
            transform: drawerOpen ? "translateX(0)" : "translateX(-100%)",
            transition: "transform 0.25s ease",
          }}
        >
          <Sidebar isMobile onNavigate={() => setDrawerOpen(false)} />
        </div>
        <main style={{ flex: 1, overflow: "auto" }}>{children}</main>
      </div>
    )
  }

  return (
    <div style={{ display: "flex", height: "100vh", minHeight: "100vh" }}>
      <button
        type="button"
        onClick={() => setSidebarHidden((value) => !value)}
        aria-label={sidebarHidden ? "メニューを表示" : "メニューを隠す"}
        style={{
          position: "fixed",
          top: 10,
          left: sidebarHidden ? 10 : SIDEBAR_WIDTH - 18,
          zIndex: 70,
          width: 26,
          height: 26,
          borderRadius: 999,
          border: "1px solid var(--border)",
          background: "var(--surface)",
          color: "var(--text)",
          cursor: "pointer",
          fontSize: 12,
          lineHeight: 1,
          boxShadow: "var(--shadow-md)",
        }}
      >
        {sidebarHidden ? ">" : "<"}
      </button>
      {!sidebarHidden && <Sidebar />}
      <main style={{ flex: 1, overflow: "auto", minWidth: 0 }}>{children}</main>
    </div>
  )
}
