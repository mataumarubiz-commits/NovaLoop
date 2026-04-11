"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useAuthOrg } from "@/hooks/useAuthOrg"

type CheckStatus = "PASS" | "FAIL" | "SKIP"
type ChecklistItem = {
  id: string
  category: string
  label: string
  hint: string
}
type RecordItem = {
  id: string
  status: CheckStatus
  memo: string
}

const STORAGE_KEY = "settings_e2e_checklist_v2"

const CHECKLIST: ChecklistItem[] = [
  {
    id: "lp_purchase_flow",
    category: "導線",
    label: "LP から購入完了と初回セットアップまで進める",
    hint: "LP 主CTA、request-org、purchase-license、pending-payment、thanks、post-purchase onboarding のつながりを確認",
  },
  { id: "login", category: "基本導線", label: "ログイン後に Home が開く", hint: "/home で KGI と制作一覧が見える" },
  { id: "contents", category: "基本導線", label: "案件明細を追加・編集できる", hint: "due_editor_at と delivery_month の自動計算も確認" },
  { id: "billing", category: "請求", label: "Billing で月次請求プレビューが出る", hint: "対象件数、金額、重複警告が見える" },
  { id: "invoices", category: "請求", label: "Invoices で PDF を確認できる", hint: "一覧、詳細、PDF を確認" },
  { id: "vendors", category: "外注", label: "Vendors で受領請求書の詳細を確認できる", hint: "振込先や PDF 導線も見る" },
  { id: "payouts", category: "外注", label: "Payouts で一括操作が使える", hint: "承認、差し戻し、支払済み、ZIP、CSV" },
  { id: "pages", category: "Pages", label: "Pages の作成・更新・コメントが動く", hint: "一覧、本文編集、コメント、復元" },
  { id: "notifications", category: "通知", label: "Notifications で通知が確認できる", hint: "承認、請求依頼、差し戻しの通知を確認" },
  { id: "discord_ops", category: "通知", label: "Discord 運用連携が固定管理チャンネルだけで動く", hint: "/settings/integrations/discord、/info、/add、/audit、重複防止、送信ログを確認" },
  { id: "export", category: "設定", label: "Export が実行できる", hint: "/settings/export でジョブ作成とダウンロードを確認" },
  { id: "import", category: "設定", label: "Import preview / apply が使える", hint: "preview の件数と apply の確認文言を見る" },
  { id: "assets", category: "設定", label: "Assets の scan / verify / copy が動く", hint: "/settings/assets でフォルダ数と URL 発行を確認" },
  { id: "health", category: "設定", label: "Health で主要機能の疎通が見える", hint: "OK / Warning / Error が読み取れる" },
  { id: "role_owner", category: "ロール", label: "owner は全管理画面を使える", hint: "Billing / Payouts / Export / Import / Audit に入れる" },
  { id: "role_assistant", category: "ロール", label: "executive_assistant は管理画面を使える", hint: "owner と同等の運用導線を確認" },
  { id: "role_member", category: "ロール", label: "member は危険設定を触れない", hint: "Billing / Export / Import / Audit を触れないことを確認" },
]

function loadRecords(): RecordItem[] {
  if (typeof window === "undefined") {
    return CHECKLIST.map((item) => ({ id: item.id, status: "SKIP", memo: "" }))
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return CHECKLIST.map((item) => ({ id: item.id, status: "SKIP", memo: "" }))
    const parsed = JSON.parse(raw) as RecordItem[]
    const map = new Map(parsed.map((item) => [item.id, item]))
    return CHECKLIST.map((item) => map.get(item.id) ?? { id: item.id, status: "SKIP", memo: "" })
  } catch {
    return CHECKLIST.map((item) => ({ id: item.id, status: "SKIP", memo: "" }))
  }
}

export default function E2ESettingsPage() {
  const { activeOrgId, role, loading, needsOnboarding } = useAuthOrg({ redirectToOnboarding: true })
  const [records, setRecords] = useState<RecordItem[]>(() => loadRecords())
  const canUse = role === "owner" || role === "executive_assistant"

  useEffect(() => {
    if (typeof window === "undefined") return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
  }, [records])

  const byId = useMemo(() => new Map(records.map((item) => [item.id, item])), [records])
  const categories = useMemo(() => [...new Set(CHECKLIST.map((item) => item.category))], [])

  if (loading) {
    return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  }

  if (!activeOrgId || needsOnboarding) {
    return (
      <div style={{ padding: 32 }}>
        <p style={{ color: "var(--muted)", marginBottom: 12 }}>ワークスペースを選択してから確認してください。</p>
        <Link href="/settings" style={{ color: "var(--primary)" }}>設定へ戻る</Link>
      </div>
    )
  }

  if (!canUse) {
    return (
      <div style={{ padding: 32 }}>
        <h1 style={{ fontSize: 24, marginBottom: 8 }}>E2E チェック</h1>
        <p style={{ color: "var(--muted)" }}>owner / executive_assistant のみ確認できます。</p>
      </div>
    )
  }

  return (
    <div style={{ padding: "32px 40px", minHeight: "100vh", background: "var(--bg-grad)" }}>
      <div style={{ maxWidth: 980, margin: "0 auto", display: "grid", gap: 16 }}>
        <header style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <h1 style={{ fontSize: 28, color: "var(--text)", margin: 0 }}>E2E チェック</h1>
            <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 8 }}>
              本番前確認でそのまま使える手動チェックリストです。
            </p>
          </div>
          <Link href="/settings/health" style={{ color: "var(--primary)", fontWeight: 600, textDecoration: "none" }}>
            Health を開く
          </Link>
        </header>

        {categories.map((category) => (
          <section
            key={category}
            style={{
              background: "var(--surface)",
              borderRadius: 16,
              border: "1px solid var(--border)",
              padding: 20,
            }}
          >
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginTop: 0, marginBottom: 16 }}>{category}</h2>
            <div style={{ display: "grid", gap: 12 }}>
              {CHECKLIST.filter((item) => item.category === category).map((item) => {
                const record = byId.get(item.id) ?? { id: item.id, status: "SKIP" as CheckStatus, memo: "" }
                return (
                  <div
                    key={item.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "120px 1fr",
                      gap: 12,
                      paddingBottom: 12,
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <select
                      value={record.status}
                      onChange={(event) =>
                        setRecords((prev) =>
                          prev.map((row) => (row.id === item.id ? { ...row, status: event.target.value as CheckStatus } : row))
                        )
                      }
                      style={{
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: "1px solid var(--border)",
                        background: "var(--input-bg)",
                      }}
                    >
                      <option value="PASS">PASS</option>
                      <option value="FAIL">FAIL</option>
                      <option value="SKIP">SKIP</option>
                    </select>
                    <div>
                      <div style={{ fontWeight: 600, color: "var(--text)" }}>{item.label}</div>
                      <div style={{ marginTop: 4, fontSize: 13, color: "var(--muted)" }}>{item.hint}</div>
                      <textarea
                        value={record.memo}
                        onChange={(event) =>
                          setRecords((prev) =>
                            prev.map((row) => (row.id === item.id ? { ...row, memo: event.target.value } : row))
                          )
                        }
                        placeholder="失敗時のメモや確認 URL を残す"
                        rows={2}
                        style={{
                          width: "100%",
                          marginTop: 8,
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: "1px solid var(--border)",
                          background: "var(--input-bg)",
                          color: "var(--text)",
                          resize: "vertical",
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
