import { Suspense } from "react"

export default function InvoicesLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <Suspense fallback={<div style={{ padding: 32, color: "var(--muted)" }}>読み込み中…</div>}>
      {children}
    </Suspense>
  )
}
