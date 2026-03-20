import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import ConditionalAppShell from "@/components/ConditionalAppShell";
import AIPalette from "@/components/AIPalette";

export const metadata: Metadata = {
  title: "NovaLoop",
  description: "SNS運用代行向けの業務OS",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
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
          <Suspense fallback={<div style={{ padding: 24, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)" }}>読み込み中…</div>}>
            {children}
          </Suspense>
        </ConditionalAppShell>
        <AIPalette />
      </body>
    </html>
  );
}
