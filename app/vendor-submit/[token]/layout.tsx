import { Suspense } from "react"

export const metadata = {
  title: "請求提出 | NovaLoop",
  description: "請求書の提出フォーム",
}

export default function VendorSubmitLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <Suspense
      fallback={
        <div
          style={{
            padding: 32,
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--muted)",
            background: "var(--bg)",
          }}
        >
          読み込み中…
        </div>
      }
    >
      {children}
    </Suspense>
  )
}
