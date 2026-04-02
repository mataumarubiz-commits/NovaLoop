"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { useAuthOrg } from "@/hooks/useAuthOrg"

type ReceiptRow = {
  id: string
  receipt_number: string
  title: string | null
  issue_date: string
  paid_at: string
  payment_method: string
  recipient_name: string
  total_amount: number
  tax_mode: string
  status: string
  is_reissue: boolean
  invoice_id: string | null
  created_at: string
}

const STATUS_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  issued: { label: "発行済み", color: "#166534", bg: "#dcfce7" },
  void:   { label: "取消済み", color: "#6b7280", bg: "#f3f4f6" },
  draft:  { label: "下書き",   color: "#92400e", bg: "#fef3c7" },
}

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  bank_transfer: "銀行振込",
  cash: "現金",
  card: "カード",
  other: "その他",
}

const formatCurrency = (v: number) =>
  new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(v)

async function getAccessToken() {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

export default function ReceiptsListPage() {
  const { activeOrgId: orgId, role, loading: authLoading } = useAuthOrg({ redirectToOnboarding: true })
  const canAccess = role === "owner" || role === "executive_assistant"

  const [receipts, setReceipts] = useState<ReceiptRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState("")
  const [pdfLoading, setPdfLoading] = useState<string | null>(null)

  const fetchReceipts = async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const token = await getAccessToken()
      if (!token) { setError("ログインが必要です"); return }

      const params = new URLSearchParams({ limit: "100" })
      if (filterStatus) params.set("status", filterStatus)

      const res = await fetch(`/api/receipts?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json().catch(() => null) as { receipts?: ReceiptRow[]; error?: string } | null
      if (!res.ok || !json) {
        setError(json?.error ?? "領収書の取得に失敗しました")
        return
      }
      setReceipts(json.receipts ?? [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (authLoading) return
    if (!canAccess) { setLoading(false); return }
    void fetchReceipts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, orgId, filterStatus])

  const openPdf = async (receiptId: string, receiptNumber: string) => {
    const token = await getAccessToken()
    if (!token) { setError("ログインが必要です"); return }
    setPdfLoading(receiptId)
    try {
      const res = await fetch(`/api/receipts/${receiptId}/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json().catch(() => null) as { signed_url?: string; error?: string } | null
      if (json?.signed_url) {
        window.open(json.signed_url, "_blank", "noopener,noreferrer")
      } else {
        setError(json?.error ?? `領収書 ${receiptNumber} のPDFを開けませんでした`)
      }
    } finally {
      setPdfLoading(null)
    }
  }

  if (authLoading || loading) {
    return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  }
  if (!canAccess) {
    return <div style={{ padding: 32, color: "var(--error-text)" }}>403: owner / executive_assistant のみアクセスできます</div>
  }

  return (
    <div style={{ padding: "24px 20px 48px" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        {/* ヘッダー */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>領収書一覧</h1>
          <Link href="/invoices" style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", textDecoration: "none", fontSize: 13 }}>
            請求書一覧へ
          </Link>
        </div>

        {error && <p style={{ color: "var(--error-text)", marginBottom: 12 }}>{error}</p>}

        {/* フィルター */}
        <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", fontSize: 13 }}
          >
            <option value="">すべてのステータス</option>
            <option value="issued">発行済み</option>
            <option value="void">取消済み</option>
          </select>
          <button
            type="button"
            onClick={() => void fetchReceipts()}
            style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", cursor: "pointer", fontSize: 13 }}
          >
            更新
          </button>
        </div>

        {/* 件数 */}
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>
          {receipts.length} 件
        </div>

        {/* テーブル */}
        {receipts.length === 0 ? (
          <div style={{ padding: "40px 24px", textAlign: "center", border: "1px solid var(--border)", borderRadius: 12, color: "var(--muted)", fontSize: 14 }}>
            {filterStatus ? "条件に合う領収書はありません" : "まだ領収書が発行されていません。請求書の入金確認後に発行できます。"}
          </div>
        ) : (
          <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                <thead>
                  <tr style={{ background: "var(--surface-2)" }}>
                    {["領収書番号", "発行日", "宛名", "金額", "決済方法", "ステータス", "操作"].map(h => (
                      <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 12, color: "var(--muted)", fontWeight: 600, borderBottom: "1px solid var(--border)" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {receipts.map(r => {
                    const st = STATUS_LABEL[r.status] ?? STATUS_LABEL.issued
                    return (
                      <tr key={r.id} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "10px 14px", fontSize: 13 }}>
                          <Link href={`/receipts/${r.id}`} style={{ color: "var(--primary)", fontWeight: 600, textDecoration: "none" }}>
                            {r.receipt_number}
                          </Link>
                          {r.is_reissue && <span style={{ marginLeft: 6, fontSize: 11, color: "#b45309", background: "#fef3c7", padding: "1px 6px", borderRadius: 4 }}>再発行</span>}
                        </td>
                        <td style={{ padding: "10px 14px", fontSize: 13 }}>{r.issue_date}</td>
                        <td style={{ padding: "10px 14px", fontSize: 13 }}>{r.recipient_name}</td>
                        <td style={{ padding: "10px 14px", fontSize: 13, fontWeight: 600 }}>{formatCurrency(r.total_amount)}</td>
                        <td style={{ padding: "10px 14px", fontSize: 13, color: "var(--muted)" }}>{PAYMENT_METHOD_LABEL[r.payment_method] ?? r.payment_method}</td>
                        <td style={{ padding: "10px 14px" }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: st.color, background: st.bg, padding: "2px 8px", borderRadius: 20 }}>
                            {st.label}
                          </span>
                        </td>
                        <td style={{ padding: "10px 14px" }}>
                          <div style={{ display: "flex", gap: 6 }}>
                            {r.status === "issued" && (
                              <button
                                type="button"
                                onClick={() => void openPdf(r.id, r.receipt_number)}
                                disabled={pdfLoading === r.id}
                                style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", cursor: pdfLoading === r.id ? "not-allowed" : "pointer", fontSize: 12 }}
                              >
                                {pdfLoading === r.id ? "..." : "PDF"}
                              </button>
                            )}
                            <Link href={`/receipts/${r.id}`} style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", textDecoration: "none", fontSize: 12 }}>
                              詳細
                            </Link>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
