import type { CSSProperties } from "react"

const cardStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 20,
  background: "var(--surface)",
  boxShadow: "var(--shadow-sm)",
}

function SkeletonBlock({ width, height, radius = 10 }: { width: string | number; height: number; radius?: number }) {
  return <div className="skeleton" aria-hidden="true" style={{ width, height, borderRadius: radius }} />
}

export default function RouteLoadingShell() {
  return (
    <div style={{ minHeight: "100vh", padding: "24px", background: "var(--bg-grad)" }} aria-busy="true" aria-live="polite">
      <div style={{ maxWidth: 1180, margin: "0 auto", display: "grid", gap: 18 }}>
        <div style={cardStyle}>
          <div style={{ padding: 20, display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "grid", gap: 10 }}>
              <SkeletonBlock width={96} height={12} />
              <SkeletonBlock width={280} height={28} />
              <SkeletonBlock width={360} height={14} />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <SkeletonBlock width={84} height={36} radius={999} />
              <SkeletonBlock width={84} height={36} radius={999} />
              <SkeletonBlock width={84} height={36} radius={999} />
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          {[0, 1, 2, 3].map((index) => (
            <div key={index} style={{ ...cardStyle, padding: 18 }}>
              <div style={{ display: "grid", gap: 10 }}>
                <SkeletonBlock width={88} height={12} />
                <SkeletonBlock width={index % 2 === 0 ? 84 : 112} height={30} />
                <SkeletonBlock width="78%" height={12} />
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          {[0, 1, 2].map((group) => (
            <div key={group} style={cardStyle}>
              <div style={{ padding: 18, display: "grid", gap: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <SkeletonBlock width={140} height={18} />
                  <SkeletonBlock width={92} height={12} />
                </div>
                <div style={{ display: "grid", gap: 10 }}>
                  {[0, 1, 2].map((row) => (
                    <div key={row} style={{ display: "grid", gap: 8, padding: "14px 0", borderTop: row === 0 ? "none" : "1px solid var(--border)" }}>
                      <SkeletonBlock width={row === 0 ? "56%" : "44%"} height={14} />
                      <SkeletonBlock width={row === 0 ? "82%" : "68%"} height={12} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
