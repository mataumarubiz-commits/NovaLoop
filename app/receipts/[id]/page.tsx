"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useAuthOrg } from "@/hooks/useAuthOrg"

type ReceiptLine = {
  id: string
  description: string
  quantity: number
  unit_price: number
  amount: number
  tax_rate: number | null
  sort_order: number
}

type IssuerSnapshot = {
  issuer_name?: string | null
  issuer_address?: string | null
  issuer_zip?: string | null
  issuer_phone?: string | null
  issuer_email?: string | null
  issuer_registration_number?: string | null
  tax_mode?: string | null
}

type TaxBreakdownItem = {
  tax_rate: number
  subtotal: number
  tax_amount: number
}

type Receipt = {
  id: string
  org_id: string
  invoice_id: string | null
  receipt_number: string
  title: string | null
  issue_date: string
  paid_at: string
  payment_method: string
  payer_note: string | null
  recipient_name: string
  subtotal_amount: number
  tax_amount: number
  total_amount: number
  tax_breakdown_json: TaxBreakdownItem[]
  tax_mode: string
  issuer_snapshot: IssuerSnapshot
  note: string | null
  pdf_path: string | null
  status: string
  void_reason: string | null
  voided_at: string | null
  is_reissue: boolean
  created_at: string
  receipt_lines: ReceiptLine[]
}

const formatCurrency = (v: number) =>
  new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(v)

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  bank_transfer: "銀行振込", cash: "現金", card: "クレジットカード", other: "その他",
}

const STATUS_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  issued: { label: "発行済み", color: "#166534", bg: "#dcfce7" },
  void:   { label: "取消済み", color: "#6b7280", bg: "#f3f4f6" },
  draft:  { label: "下書き",   color: "#92400e", bg: "#fef3c7" },
}

async function getAccessToken() {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

// ─── 取消モーダル ──────────────────────────────────────────────────────────
function VoidModal({
  receiptId,
  receiptNumber,
  onClose,
  onVoided,
}: {
  receiptId: string
  receiptNumber: string
  onClose: () => void
  onVoided: () => void
}) {
  const [reason, setReason] = useState("")
  const [voiding, setVoiding] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const handleVoid = async () => {
    setErr(null)
    setVoiding(true)
    try {
      const token = await getAccessToken()
      if (!token) { setErr("ログインが必要です"); setVoiding(false); return }
      const res = await fetch(`/api/receipts/${receiptId}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ void_reason: reason || null }),
      })
      const json = await res.json().catch(() => null) as { ok?: boolean; error?: string } | null
      if (!res.ok) { setErr(json?.error ?? "取消に失敗しました"); setVoiding(false); return }
      onVoided()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "通信エラー")
    } finally {
      setVoiding(false)
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "var(--surface)", borderRadius: 16, padding: 28, width: "100%", maxWidth: 440, boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
        <h2 style={{ margin: "0 0 8px", fontSize: 18, color: "var(--error-text)" }}>領収書を取消</h2>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--muted)" }}>
          {receiptNumber} を取消します。取消後は元に戻せません。<br />
          修正が必要な場合は、取消後に新しい領収書を再発行してください。
        </p>
        {err && <p style={{ color: "var(--error-text)", margin: "0 0 12px", fontSize: 13 }}>{err}</p>}
        <label style={{ display: "grid", gap: 4, marginBottom: 20 }}>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>取消理由（任意）</span>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={2}
            placeholder="例: 金額誤りのため"
            style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", resize: "vertical" }}
          />
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button type="button" onClick={onClose} disabled={voiding} style={{ padding: "9px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", cursor: "pointer" }}>キャンセル</button>
          <button type="button" onClick={() => void handleVoid()} disabled={voiding} style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: "var(--error-text, #dc2626)", color: "#fff", fontWeight: 700, cursor: voiding ? "not-allowed" : "pointer" }}>
            {voiding ? "取消中..." : "取消する"}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ReceiptDetailPage() {
  const params = useParams()
  const id = typeof params.id === "string" ? params.id : null
  const { role, loading: authLoading } = useAuthOrg({ redirectToOnboarding: true })
  const canAccess = role === "owner" || role === "executive_assistant"

  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [showVoidModal, setShowVoidModal] = useState(false)

  const loadReceipt = async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const token = await getAccessToken()
      if (!token) { setError("ログインが必要です"); return }
      const res = await fetch(`/api/receipts/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json().catch(() => null) as { receipt?: Receipt; error?: string } | null
      if (!res.ok || !json?.receipt) { setError(json?.error ?? "領収書の取得に失敗しました"); return }
      setReceipt(json.receipt)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (authLoading) return
    if (!canAccess) { setLoading(false); return }
    void loadReceipt()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, id])

  const openPdf = async () => {
    if (!id || !receipt) return
    const token = await getAccessToken()
    if (!token) { setError("ログインが必要です"); return }
    setPdfLoading(true)
    try {
      const res = await fetch(`/api/receipts/${id}/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json().catch(() => null) as { signed_url?: string; error?: string } | null
      if (json?.signed_url) {
        window.open(json.signed_url, "_blank", "noopener,noreferrer")
      } else {
        setError(json?.error ?? "PDFを開けませんでした")
      }
    } finally {
      setPdfLoading(false)
    }
  }

  if (authLoading || loading) return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  if (!canAccess) return <div style={{ padding: 32, color: "var(--error-text)" }}>403: owner / executive_assistant のみアクセスできます</div>
  if (!receipt) return (
    <div style={{ padding: 32 }}>
      <p style={{ color: "var(--muted)" }}>{error ?? "領収書が見つかりません"}</p>
      <Link href="/receipts" style={{ color: "var(--primary)", fontWeight: 600 }}>領収書一覧へ</Link>
    </div>
  )

  const st = STATUS_LABEL[receipt.status] ?? STATUS_LABEL.issued
  const issuer = receipt.issuer_snapshot ?? {}
  const isRegistered = receipt.tax_mode === "registered_taxable" && !!issuer.issuer_registration_number
  const sortedLines = [...receipt.receipt_lines].sort((a, b) => a.sort_order - b.sort_order)

  return (
    <div style={{ padding: "24px 20px 48px" }}>
      {showVoidModal && (
        <VoidModal
          receiptId={receipt.id}
          receiptNumber={receipt.receipt_number}
          onClose={() => setShowVoidModal(false)}
          onVoided={() => { setShowVoidModal(false); void loadReceipt() }}
        />
      )}

      <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 28, background: "var(--surface)", boxShadow: "var(--shadow-sm)", maxWidth: 900, margin: "0 auto" }}>

        {/* ヘッダー */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <h1 style={{ margin: 0, fontSize: 22 }}>領収書</h1>
              <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700, color: st.color, background: st.bg }}>{st.label}</span>
              {receipt.is_reissue && <span style={{ fontSize: 12, color: "#b45309", background: "#fef3c7", padding: "2px 8px", borderRadius: 20 }}>再発行</span>}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--muted)" }}>{receipt.receipt_number}</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {receipt.status === "issued" && (
              <button type="button" onClick={() => void openPdf()} disabled={pdfLoading} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "var(--primary)", color: "#fff", fontWeight: 700, cursor: pdfLoading ? "not-allowed" : "pointer" }}>
                {pdfLoading ? "準備中..." : "PDFをダウンロード"}
              </button>
            )}
            {receipt.status === "issued" && (
              <button type="button" onClick={() => setShowVoidModal(true)} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid var(--error-text, #dc2626)", background: "var(--surface)", color: "var(--error-text, #dc2626)", cursor: "pointer", fontSize: 13 }}>
                取消
              </button>
            )}
            {receipt.invoice_id && (
              <Link href={`/invoices/${receipt.invoice_id}`} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", textDecoration: "none", fontSize: 13 }}>
                対象請求書
              </Link>
            )}
            <Link href="/receipts" style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", textDecoration: "none", fontSize: 13 }}>
              一覧へ
            </Link>
          </div>
        </div>

        {error && <p style={{ color: "var(--error-text)", marginBottom: 12 }}>{error}</p>}

        {receipt.status === "void" && (
          <div style={{ padding: "10px 16px", background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: 8, marginBottom: 20, fontSize: 13 }}>
            <strong>取消済み</strong>
            {receipt.void_reason && <span>：{receipt.void_reason}</span>}
            {receipt.voided_at && <span style={{ color: "var(--muted)", marginLeft: 8 }}>{receipt.voided_at.slice(0, 10)}</span>}
          </div>
        )}

        {/* 2カラム: 領収情報 + 発行者 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 24 }}>
          <div style={{ padding: 16, border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface-2)" }}>
            <strong style={{ display: "block", marginBottom: 10, fontSize: 14 }}>領収情報</strong>
            <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
              <div><span style={{ color: "var(--muted)" }}>宛名:</span> <strong>{receipt.recipient_name} 御中</strong></div>
              <div><span style={{ color: "var(--muted)" }}>発行日:</span> {receipt.issue_date}</div>
              <div><span style={{ color: "var(--muted)" }}>入金日:</span> {receipt.paid_at}</div>
              <div><span style={{ color: "var(--muted)" }}>決済方法:</span> {PAYMENT_METHOD_LABEL[receipt.payment_method] ?? receipt.payment_method}</div>
              {receipt.payer_note && <div><span style={{ color: "var(--muted)" }}>振込名義:</span> {receipt.payer_note}</div>}
              <div style={{ marginTop: 4, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                <span style={{ color: "var(--muted)" }}>受領金額:</span>{" "}
                <strong style={{ fontSize: 18 }}>{formatCurrency(receipt.total_amount)}</strong>
                <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: 4 }}>（税込）</span>
              </div>
              {receipt.tax_amount > 0 && (
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  小計 {formatCurrency(receipt.subtotal_amount)} + 消費税 {formatCurrency(receipt.tax_amount)}
                </div>
              )}
            </div>
          </div>

          <div style={{ padding: 16, border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface-2)" }}>
            <strong style={{ display: "block", marginBottom: 10, fontSize: 14 }}>発行者</strong>
            <div style={{ fontSize: 13, lineHeight: 1.8 }}>
              <div style={{ fontWeight: 700 }}>{issuer.issuer_name}</div>
              {issuer.issuer_zip && <div>〒{issuer.issuer_zip}</div>}
              {issuer.issuer_address && <div>{issuer.issuer_address}</div>}
              {issuer.issuer_phone && <div>TEL: {issuer.issuer_phone}</div>}
              {issuer.issuer_email && <div>{issuer.issuer_email}</div>}
              {isRegistered && <div style={{ marginTop: 4, fontSize: 12, color: "var(--muted)" }}>登録番号: {issuer.issuer_registration_number}</div>}
              {receipt.tax_mode === "exempt" && <div style={{ marginTop: 4, fontSize: 12, color: "var(--muted)" }}>※ 適格請求書発行事業者ではありません</div>}
            </div>
          </div>
        </div>

        {/* 明細 */}
        <h2 style={{ fontSize: 15, marginBottom: 8 }}>明細</h2>
        <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", marginBottom: 16 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--surface-2)" }}>
                <th style={{ padding: "9px 12px", textAlign: "left", fontSize: 12, color: "var(--muted)", fontWeight: 600, borderBottom: "1px solid var(--border)" }}>品目</th>
                <th style={{ padding: "9px 12px", textAlign: "right", fontSize: 12, color: "var(--muted)", fontWeight: 600, borderBottom: "1px solid var(--border)" }}>数量</th>
                <th style={{ padding: "9px 12px", textAlign: "right", fontSize: 12, color: "var(--muted)", fontWeight: 600, borderBottom: "1px solid var(--border)" }}>単価</th>
                <th style={{ padding: "9px 12px", textAlign: "right", fontSize: 12, color: "var(--muted)", fontWeight: 600, borderBottom: "1px solid var(--border)" }}>金額</th>
                {isRegistered && <th style={{ padding: "9px 12px", textAlign: "center", fontSize: 12, color: "var(--muted)", fontWeight: 600, borderBottom: "1px solid var(--border)" }}>税率</th>}
              </tr>
            </thead>
            <tbody>
              {sortedLines.map(l => (
                <tr key={l.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "9px 12px", fontSize: 13 }}>{l.description}</td>
                  <td style={{ padding: "9px 12px", fontSize: 13, textAlign: "right" }}>{l.quantity}</td>
                  <td style={{ padding: "9px 12px", fontSize: 13, textAlign: "right" }}>{formatCurrency(l.unit_price)}</td>
                  <td style={{ padding: "9px 12px", fontSize: 13, textAlign: "right", fontWeight: 500 }}>{formatCurrency(l.amount)}</td>
                  {isRegistered && <td style={{ padding: "9px 12px", fontSize: 13, textAlign: "center", color: "var(--muted)" }}>{l.tax_rate != null ? `${Math.round(l.tax_rate * 100)}%` : "—"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 合計 */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, marginBottom: receipt.tax_breakdown_json?.length > 0 ? 12 : 24 }}>
          {receipt.tax_amount > 0 && (
            <>
              <div style={{ fontSize: 13, color: "var(--muted)", display: "flex", gap: 24 }}>
                <span>小計</span><span>{formatCurrency(receipt.subtotal_amount)}</span>
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)", display: "flex", gap: 24 }}>
                <span>消費税</span><span>{formatCurrency(receipt.tax_amount)}</span>
              </div>
            </>
          )}
          <div style={{ fontSize: 17, fontWeight: 700, display: "flex", gap: 24, borderTop: "2px solid var(--text)", paddingTop: 8 }}>
            <span>合計（税込）</span><span>{formatCurrency(receipt.total_amount)}</span>
          </div>
        </div>

        {/* 税区分内訳 */}
        {isRegistered && receipt.tax_breakdown_json?.length > 0 && (
          <div style={{ marginBottom: 20, padding: "10px 14px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--muted)" }}>
            <strong style={{ display: "block", marginBottom: 6, color: "var(--text)" }}>消費税内訳</strong>
            {receipt.tax_breakdown_json.map((t, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{Math.round(t.tax_rate * 100)}% 対象（小計 {formatCurrency(t.subtotal)}）</span>
                <span>消費税 {formatCurrency(t.tax_amount)}</span>
              </div>
            ))}
          </div>
        )}

        {/* 備考 */}
        {receipt.note && (
          <div style={{ padding: "10px 14px", background: "var(--surface-2)", borderLeft: "3px solid var(--border)", borderRadius: "0 8px 8px 0", fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
            <strong style={{ display: "block", marginBottom: 4, color: "var(--text)" }}>備考</strong>
            {receipt.note}
          </div>
        )}

        {/* 発行メタ */}
        <div style={{ fontSize: 12, color: "var(--muted)", borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          発行日時: {receipt.created_at.slice(0, 16).replace("T", " ")}
        </div>
      </div>
    </div>
  )
}
