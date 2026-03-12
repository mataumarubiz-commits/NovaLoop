"use client"

import { usePathname } from "next/navigation"
import AppShell from "./AppShell"

export default function ConditionalAppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isOnboarding = pathname === "/onboarding" || (pathname?.startsWith("/onboarding/") ?? false)
  if (isOnboarding) return <>{children}</>
  return <AppShell>{children}</AppShell>
}
