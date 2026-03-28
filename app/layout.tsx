import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import ConditionalAppShell from "@/components/ConditionalAppShell";
import AIPalette from "@/components/AIPalette";
import RouteLoadingShell from "@/components/RouteLoadingShell";

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
          <Suspense fallback={<RouteLoadingShell />}>
            {children}
          </Suspense>
        </ConditionalAppShell>
        <AIPalette />
      </body>
    </html>
  );
}
