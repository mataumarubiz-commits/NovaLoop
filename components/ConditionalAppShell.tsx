"use client"

import { usePathname } from "next/navigation"
import AppShell from "./AppShell"

export default function ConditionalAppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isOnboarding = pathname === "/onboarding" || (pathname?.startsWith("/onboarding/") ?? false)
  const isAuthFinish = pathname === "/auth/finish" || (pathname?.startsWith("/auth/finish/") ?? false)
  const isPageEmbed = /^\/pages\/[^/]+\/embed$/.test(pathname ?? "")
  if (isOnboarding || isAuthFinish || isPageEmbed) return <>{children}</>
  return <AppShell>{children}</AppShell>
}
