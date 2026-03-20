"use client"

import Link from "next/link"
import type { OnboardingItemDefinition } from "@/lib/onboarding"

type OnboardingGuideItem = OnboardingItemDefinition & {
  completed: boolean
  completed_at: string | null
}

type OnboardingGuideProps = {
  items: OnboardingGuideItem[]
  completionRate: number
}

type GuideGroupKey = "setup" | "ops" | "finance"

type GuideMeta = {
  group: GuideGroupKey
  icon: string
  channel: string
  hint: string
  accent: string
}

const GUIDE_GROUPS: Array<{ key: GuideGroupKey; label: string; description: string }> = [
  { key: "setup", label: "始めましょう", description: "土台を先に揃える" },
  { key: "ops", label: "運用を整える", description: "毎日触る導線をつくる" },
  { key: "finance", label: "締めを整える", description: "月末の事故を防ぐ" },
]

const GUIDE_META: Record<string, GuideMeta> = {
  company_profile: {
    group: "setup",
    icon: "WS",
    channel: "workspace-profile",
    hint: "会社情報",
    accent: "#7c3aed",
  },
  bank_account: {
    group: "setup",
    icon: "BK",
    channel: "bank-account",
    hint: "口座",
    accent: "#7c3aed",
  },
  client_created: {
    group: "setup",
    icon: "CL",
    channel: "first-client",
    hint: "取引先",
    accent: "#7c3aed",
  },
  manual_page: {
    group: "ops",
    icon: "PG",
    channel: "pages-manual",
    hint: "手順",
    accent: "#6d28d9",
  },
  first_content: {
    group: "ops",
    icon: "CT",
    channel: "first-content",
    hint: "案件",
    accent: "#6d28d9",
  },
  notifications_checked: {
    group: "ops",
    icon: "NT",
    channel: "notifications",
    hint: "通知",
    accent: "#6d28d9",
  },
  ai_first_use: {
    group: "ops",
    icon: "AI",
    channel: "ai-assist",
    hint: "補助",
    accent: "#6d28d9",
  },
  first_invoice: {
    group: "finance",
    icon: "IV",
    channel: "first-invoice",
    hint: "請求",
    accent: "#f59e0b",
  },
  vendor_flow: {
    group: "finance",
    icon: "VD",
    channel: "vendor-flow",
    hint: "外注",
    accent: "#f59e0b",
  },
}

export default function OnboardingGuide({ items, completionRate }: OnboardingGuideProps) {
  const completedCount = items.filter((item) => item.completed).length
  const remainingCount = Math.max(0, items.length - completedCount)
  const groupedItems = GUIDE_GROUPS.map((group) => ({
    ...group,
    items: items.filter((item) => GUIDE_META[item.key].group === group.key),
  })).filter((group) => group.items.length > 0)

  return (
    <section className="guide-card" aria-label="導入チェックリスト">
      <div className="guide-kicker">導入ガイド</div>

      <div className="guide-banner" aria-hidden="true">
        <span className="guide-cloud guide-cloud-left" />
        <span className="guide-cloud guide-cloud-mid" />
        <span className="guide-cloud guide-cloud-right" />
        <span className="guide-spark guide-spark-left" />
        <span className="guide-spark guide-spark-right" />
      </div>

      <div className="guide-avatar" aria-hidden="true">
        <span>N</span>
      </div>

      <div className="guide-head">
        <div className="guide-title-wrap">
          <div className="guide-title-row">
            <h2>導入チェックリスト</h2>
            <span className="guide-progress-pill">{completedCount}/{items.length}</span>
          </div>
          <p>上から順に開けば、最短で運用を立ち上げられます。</p>
        </div>

        <div className="guide-meter-wrap" aria-label={`完了率 ${completionRate}%`}>
          <div className="guide-meter-meta">
            <span>進行</span>
            <strong>{completionRate}%</strong>
          </div>
          <div className="guide-meter-track">
            <span className="guide-meter-fill" style={{ width: `${completionRate}%` }} />
          </div>
          <div className="guide-meter-caption">{remainingCount === 0 ? "すべて完了" : `あと ${remainingCount} 項目`}</div>
        </div>
      </div>

      <div className="guide-message">
        <div className="guide-message-badge">N</div>
        <div className="guide-message-copy">
          <strong>NovaLoop Guide</strong>
          <span>まずは設定と最初の導線だけ揃えましょう。細かい説明は必要なときにだけ見れば十分です。</span>
        </div>
      </div>

      <div className="guide-sections">
        {groupedItems.map((group) => (
          <section key={group.key} className="guide-section">
            <header className="guide-section-head">
              <h3>{group.label}</h3>
              <p>{group.description}</p>
            </header>

            <div className="guide-task-list">
              {group.items.map((item) => {
                const meta = GUIDE_META[item.key]

                return (
                  <div key={item.key} className={item.completed ? "guide-task is-complete" : "guide-task"}>
                    <Link href={item.href} className="guide-task-main">
                      <span className="guide-task-icon" style={{ color: meta.accent, borderColor: `${meta.accent}33` }}>
                        {meta.icon}
                      </span>

                      <span className="guide-task-copy">
                        <span className="guide-task-title">{item.title}</span>
                        <span className="guide-task-summary">{item.description}</span>
                        <span className="guide-task-meta">
                          <span className="guide-task-channel">#{meta.channel}</span>
                          <span className="guide-task-hint">{meta.hint}</span>
                        </span>
                        {item.todo || item.doneWhen ? (
                          <span className="guide-task-detail-list">
                            {item.todo ? (
                              <span className="guide-task-detail">
                                <strong>やること</strong>
                                <span>{item.todo}</span>
                              </span>
                            ) : null}
                            {item.doneWhen ? (
                              <span className="guide-task-detail">
                                <strong>おわり</strong>
                                <span>{item.doneWhen}</span>
                              </span>
                            ) : null}
                          </span>
                        ) : null}
                      </span>

                      <span className="guide-task-state" aria-hidden="true">
                        <span className="guide-task-state-ring">{item.completed ? "✓" : ""}</span>
                      </span>
                    </Link>

                    {item.helpHref ? (
                      <Link href={item.helpHref} className="guide-task-help">
                        ガイド
                      </Link>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </div>

      <style jsx>{`
        .guide-card {
          position: relative;
          overflow: hidden;
          border-radius: 24px;
          border: 1px solid var(--border);
          background:
            radial-gradient(circle at top left, rgba(167, 139, 250, 0.16), transparent 26%),
            linear-gradient(
              180deg,
              color-mix(in srgb, var(--surface) 68%, white 32%) 0%,
              color-mix(in srgb, var(--surface) 88%, white 12%) 100%
            );
          color: var(--text);
          box-shadow: 0 20px 40px rgba(15, 23, 42, 0.08);
          padding: 18px 18px 20px;
          margin-bottom: 16px;
        }

        .guide-kicker {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: #6d28d9;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.06em;
          margin-bottom: 14px;
        }

        .guide-kicker::before {
          content: "";
          width: 12px;
          height: 12px;
          border-radius: 3px;
          background: linear-gradient(180deg, #8b5cf6 0%, #6d28d9 100%);
          box-shadow: 0 4px 10px rgba(109, 40, 217, 0.22);
        }

        .guide-banner {
          position: relative;
          height: 110px;
          border-radius: 20px;
          background:
            radial-gradient(circle at top left, rgba(167, 139, 250, 0.24), transparent 32%),
            linear-gradient(180deg, #2a2652 0%, #1f243b 100%);
          border: 1px solid rgba(109, 40, 217, 0.16);
          overflow: hidden;
        }

        .guide-cloud {
          position: absolute;
          display: block;
          background: rgba(255, 255, 255, 0.92);
          opacity: 0.98;
          filter: drop-shadow(0 8px 18px rgba(15, 23, 42, 0.18));
        }

        .guide-cloud::before,
        .guide-cloud::after {
          content: "";
          position: absolute;
          background: inherit;
          border-radius: 999px;
        }

        .guide-cloud-left {
          width: 162px;
          height: 50px;
          left: -12px;
          top: 28px;
          border-radius: 999px;
        }

        .guide-cloud-left::before {
          width: 74px;
          height: 74px;
          left: 44px;
          top: -30px;
        }

        .guide-cloud-left::after {
          width: 50px;
          height: 50px;
          left: 114px;
          top: -12px;
        }

        .guide-cloud-mid {
          width: 178px;
          height: 42px;
          left: 180px;
          top: 46px;
          border-radius: 999px;
        }

        .guide-cloud-mid::before {
          width: 92px;
          height: 58px;
          left: 16px;
          top: -26px;
        }

        .guide-cloud-mid::after {
          width: 72px;
          height: 46px;
          left: 84px;
          top: -8px;
        }

        .guide-cloud-right {
          width: 184px;
          height: 58px;
          right: -8px;
          top: 18px;
          border-radius: 999px;
        }

        .guide-cloud-right::before {
          width: 82px;
          height: 82px;
          left: 34px;
          top: -28px;
        }

        .guide-cloud-right::after {
          width: 86px;
          height: 52px;
          left: 94px;
          top: -6px;
        }

        .guide-spark {
          position: absolute;
          width: 12px;
          height: 12px;
          transform: rotate(45deg);
          background: rgba(255, 255, 255, 0.78);
          opacity: 0.82;
        }

        .guide-spark-left {
          left: 308px;
          top: 18px;
        }

        .guide-spark-right {
          right: 96px;
          top: 18px;
        }

        .guide-avatar {
          position: relative;
          width: 86px;
          height: 86px;
          margin-top: -32px;
          border-radius: 24px;
          background:
            radial-gradient(circle at 40% 32%, rgba(196, 181, 253, 0.74), transparent 28%),
            linear-gradient(180deg, #17162c 0%, #0f172a 100%);
          border: 6px solid color-mix(in srgb, var(--surface) 74%, white 26%);
          box-shadow:
            0 12px 24px rgba(15, 23, 42, 0.12),
            inset 0 1px 0 rgba(255, 255, 255, 0.12);
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .guide-avatar span {
          color: #ede9fe;
          font-size: 30px;
          font-weight: 800;
          letter-spacing: 0.08em;
        }

        .guide-head {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 16px;
          align-items: end;
          margin-top: 16px;
        }

        .guide-title-row {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .guide-title-row h2 {
          margin: 0;
          color: var(--text);
          font-size: clamp(1.5rem, 3vw, 2rem);
          line-height: 1.1;
          font-weight: 800;
          letter-spacing: -0.03em;
        }

        .guide-progress-pill {
          display: inline-flex;
          align-items: center;
          min-height: 28px;
          padding: 0 12px;
          border-radius: 999px;
          background: color-mix(in srgb, var(--surface-2) 78%, white 22%);
          border: 1px solid var(--border);
          color: #6d28d9;
          font-size: 12px;
          font-weight: 700;
        }

        .guide-title-wrap p {
          margin: 8px 0 0;
          color: var(--muted);
          font-size: 14px;
          line-height: 1.7;
        }

        .guide-meter-wrap {
          min-width: 164px;
          padding: 12px 14px;
          border-radius: 16px;
          background: color-mix(in srgb, var(--surface-2) 70%, white 30%);
          border: 1px solid color-mix(in srgb, var(--border) 84%, white 16%);
        }

        .guide-meter-meta {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
          color: var(--muted);
          font-size: 12px;
          font-weight: 700;
        }

        .guide-meter-meta strong {
          color: var(--text);
          font-size: 20px;
          line-height: 1;
        }

        .guide-meter-track {
          height: 8px;
          border-radius: 999px;
          background: color-mix(in srgb, var(--border) 54%, white 46%);
          margin-top: 10px;
          overflow: hidden;
        }

        .guide-meter-fill {
          display: block;
          height: 100%;
          border-radius: inherit;
          background: linear-gradient(90deg, #8b5cf6 0%, #6d28d9 100%);
          box-shadow: 0 0 18px rgba(124, 58, 237, 0.2);
        }

        .guide-meter-caption {
          margin-top: 10px;
          color: var(--muted);
          font-size: 12px;
        }

        .guide-message {
          margin-top: 16px;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 12px;
          align-items: start;
          padding: 14px;
          border-radius: 16px;
          border: 1px solid color-mix(in srgb, var(--border) 84%, white 16%);
          background: color-mix(in srgb, var(--surface-2) 52%, white 48%);
        }

        .guide-message-badge {
          width: 38px;
          height: 38px;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(180deg, #8b5cf6 0%, #6d28d9 100%);
          color: #fff;
          font-size: 14px;
          font-weight: 800;
        }

        .guide-message-copy {
          display: grid;
          gap: 4px;
        }

        .guide-message-copy strong {
          color: var(--text);
          font-size: 14px;
        }

        .guide-message-copy span {
          color: var(--muted);
          font-size: 13px;
          line-height: 1.7;
        }

        .guide-sections {
          margin-top: 20px;
          display: grid;
          gap: 16px;
        }

        .guide-section {
          display: grid;
          gap: 10px;
        }

        .guide-section-head {
          display: grid;
          gap: 4px;
        }

        .guide-section-head h3 {
          margin: 0;
          color: var(--text);
          font-size: 15px;
          font-weight: 800;
        }

        .guide-section-head p {
          margin: 0;
          color: var(--muted);
          font-size: 12px;
        }

        .guide-task-list {
          display: grid;
          gap: 10px;
        }

        .guide-task {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 10px;
          align-items: center;
          padding: 10px;
          border-radius: 16px;
          border: 1px solid color-mix(in srgb, var(--border) 80%, white 20%);
          background: color-mix(in srgb, var(--surface-2) 32%, white 68%);
          transition:
            transform 0.2s ease,
            border-color 0.2s ease,
            background-color 0.2s ease,
            box-shadow 0.2s ease;
        }

        .guide-task:hover {
          transform: translateY(-1px);
          border-color: color-mix(in srgb, var(--border) 88%, #8b5cf6 12%);
          background: color-mix(in srgb, var(--surface-2) 52%, white 48%);
          box-shadow: 0 14px 24px rgba(15, 23, 42, 0.08);
        }

        .guide-task.is-complete {
          background: color-mix(in srgb, #dcfce7 68%, white 32%);
          border-color: color-mix(in srgb, #86efac 64%, var(--border) 36%);
        }

        .guide-task-main {
          min-width: 0;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          gap: 12px;
          align-items: center;
          text-decoration: none;
        }

        .guide-task-icon {
          width: 44px;
          height: 44px;
          border-radius: 999px;
          border: 1px solid;
          background: color-mix(in srgb, var(--surface-2) 76%, white 24%);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.08em;
          flex-shrink: 0;
        }

        .guide-task-copy {
          min-width: 0;
          display: grid;
          gap: 5px;
        }

        .guide-task-title {
          color: var(--text);
          font-size: 16px;
          font-weight: 800;
          line-height: 1.3;
        }

        .guide-task-meta {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .guide-task-channel {
          color: #6d28d9;
          font-size: 12px;
          font-weight: 700;
        }

        .guide-task-hint {
          display: inline-flex;
          align-items: center;
          min-height: 22px;
          padding: 0 9px;
          border-radius: 999px;
          background: color-mix(in srgb, var(--surface-2) 82%, white 18%);
          border: 1px solid color-mix(in srgb, var(--border) 76%, white 24%);
          color: var(--muted);
          font-size: 11px;
          font-weight: 700;
        }

        .guide-task-summary {
          color: var(--muted);
          font-size: 13px;
          line-height: 1.7;
        }

        .guide-task-detail-list {
          display: grid;
          gap: 6px;
          margin-top: 2px;
        }

        .guide-task-detail {
          display: grid;
          gap: 2px;
          padding: 8px 10px;
          border-radius: 12px;
          background: color-mix(in srgb, var(--surface-2) 74%, white 26%);
          border: 1px solid color-mix(in srgb, var(--border) 78%, white 22%);
        }

        .guide-task-detail strong {
          color: var(--text);
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.04em;
        }

        .guide-task-detail span {
          color: var(--muted);
          font-size: 12px;
          line-height: 1.6;
        }

        .guide-task-state {
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .guide-task-state-ring {
          width: 24px;
          height: 24px;
          border-radius: 999px;
          border: 2px solid color-mix(in srgb, var(--border) 72%, #94a3b8 28%);
          color: #4ade80;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 13px;
          font-weight: 800;
        }

        .guide-task.is-complete .guide-task-state-ring {
          border-color: #4ade80;
          background: rgba(34, 197, 94, 0.14);
        }

        .guide-task-help {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 34px;
          padding: 0 12px;
          border-radius: 999px;
          border: 1px solid color-mix(in srgb, var(--border) 80%, white 20%);
          background: color-mix(in srgb, var(--surface-2) 70%, white 30%);
          color: var(--text);
          text-decoration: none;
          font-size: 12px;
          font-weight: 700;
          white-space: nowrap;
        }

        @media (max-width: 860px) {
          .guide-head {
            grid-template-columns: 1fr;
            align-items: start;
          }
        }

        @media (max-width: 640px) {
          .guide-card {
            padding: 16px;
            border-radius: 20px;
          }

          .guide-banner {
            height: 90px;
          }

          .guide-avatar {
            width: 74px;
            height: 74px;
          }

          .guide-task {
            grid-template-columns: 1fr;
          }

          .guide-task-help {
            width: fit-content;
          }

          .guide-task-title {
            font-size: 15px;
          }
        }
      `}</style>
    </section>
  )
}
