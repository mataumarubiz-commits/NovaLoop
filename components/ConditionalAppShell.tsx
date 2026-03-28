"use client"

import { usePathname } from "next/navigation"
import AppShell from "./AppShell"

export default function ConditionalAppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isOnboarding = pathname === "/onboarding" || (pathname?.startsWith("/onboarding/") ?? false)
  const isAuthFinish = pathname === "/auth/finish" || (pathname?.startsWith("/auth/finish/") ?? false)
  const isPageEmbed = /^\/pages\/[^/]+\/embed$/.test(pathname ?? "")
  const isVendorSubmit = pathname?.startsWith("/vendor-submit") ?? false
  const isPlatformFlow =
    pathname === "/join-request" ||
    pathname === "/request-org" ||
    pathname === "/purchase-license" ||
    pathname === "/pending-payment" ||
    pathname === "/recover-license" ||
    pathname === "/settings/license" ||
    (pathname?.startsWith("/platform/") ?? false)
  if (isOnboarding || isAuthFinish || isPageEmbed || isVendorSubmit || isPlatformFlow) return <>{children}</>
  return <AppShell>{children}</AppShell>
}
