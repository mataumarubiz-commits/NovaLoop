import type { Metadata, Viewport } from "next"
import { Suspense } from "react"
import "./globals.css"
import ConditionalAppShell from "@/components/ConditionalAppShell"
import AIPalette from "@/components/AIPalette"
import RouteLoadingShell from "@/components/RouteLoadingShell"

export const metadata: Metadata = {
  title: "NovaLoop",
  description: "SNS運用と制作進行をまとめて扱うオペレーションOS",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "NovaLoop",
  },
  icons: {
    icon: [
      { url: "/logo.png", sizes: "192x192", type: "image/png" },
      { url: "/logo-light.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/logo.png", sizes: "192x192", type: "image/png" }],
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f6efe5",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body
        className="antialiased"
        suppressHydrationWarning
        style={{ fontFamily: "var(--font-inter), var(--font-noto-sans-jp), sans-serif" }}
      >
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t=localStorage.getItem("settings_theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t);})();`,
          }}
        />
        <ConditionalAppShell>
          <Suspense fallback={<RouteLoadingShell />}>{children}</Suspense>
        </ConditionalAppShell>
        <AIPalette />
      </body>
    </html>
  )
}
