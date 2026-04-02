"use client"

import { useEffect, useMemo, useState, type CSSProperties } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { buildInvoicePdfBaseName, resolveInvoiceRecipientLabel, resolveInvoiceRecipientName } from "@/lib/invoiceNaming"
import { describeInvoiceSourceType } from "@/lib/invoiceSourceType"
import { supabase } from "@/lib/supabase"
import { useAuthOrg } from "@/hooks/useAuthOrg"
import type { ApplyAiResultDetail } from "@/lib/aiClientEvents"

const cardStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 24,
  background: "var(--surface)",
  boxShadow: "var(--shadow-sm)",
  maxWidth: 1080,
  margin: "0 auto",
}

type InvoiceLine = {
  id: string
  quantity: number
  unit_price: number
  amount: number
  description: string | null
  content_id?: string | null
  project_name?: string | null
  title?: string | null
}

type Invoice = {
  id: string
  org_id: string
  client_id: string | null
  invoice_month: string
  invoice_title: string | null
  invoice_no: string | null
  issue_date: string
  due_date: string
  status: string
  subtotal: number
  total: number | null
  tax_mode: string | null
  tax_amount: number | null
  withholding_enabled: boolean | null
  withholding_amount: number | null
  notes: string | null
  source_type: string | null
  guest_client_name: string | null
  guest_company_name: string | null
  guest_client_email: string | null
  guest_client_address: string | null
  issuer_snapshot: Record<string, unknown> | null
  bank_snapshot: Record<string, unknown> | null
  // 入金フィールド（068_receipts.sql で追加）
  payment_status: string | null
  paid_at: string | null
  paid_amount: number | null
  payment_method: string | null
  payment_memo: string | null
  payment_note: string | null
  latest_receipt_id: string | null
  public_token: string | null
  client_notified_at: string | null
  client_paid_at_claimed: string | null
  client_paid_amount_claimed: number | null
  client_transfer_name: string | null
  client_notify_note: string | null
  clients?: { name: string } | null
  invoice_lines?: InvoiceLine[] | null
}

const formatCurrency = (value: number | null | undefined) =>
  new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(Number(value || 0))

function defaultFileName(inv: Invoice) {
  return `${buildInvoicePdfBaseName({
    invoiceMonth: inv.invoice_month,
    clientName: inv.clients?.name,
    guestCompanyName: inv.guest_company_name,
    guestClientName: inv.guest_client_name,
    invoiceTitle: inv.invoice_title,
  })}.pdf`
}

async function getAccessToken() {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

function resolveRuntimeAppUrl() {
  if (typeof window === "undefined") return ""
  const runtimeEnv = (
    window as typeof window & {
      __NOVALOOP_PUBLIC_ENV__?: { appUrl?: string }
    }
  ).__NOVALOOP_PUBLIC_ENV__
  return runtimeEnv?.appUrl?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim() || window.location.origin
}

// ─── 入金記録モーダル ──────────────────────────────────────────────────────
function RecordPaymentModal({
  invoiceId,
  invoiceTotal,
  onClose,
  onSaved,
}: {
  invoiceId: string
  invoiceTotal: number
  onClose: () => void
  onSaved: () => void
}) {
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10))
  const [paidAmount, setPaidAmount] = useState(String(invoiceTotal))
  const [method, setMethod] = useState("bank_transfer")
  const [memo, setMemo] = useState("")
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)

  const handleSubmit = async () => {
    setErr(null)
    setWarning(null)
    const amount = Number(paidAmount)
    if (!paidAt || isNaN(amount) || amount <= 0) {
      setErr("入金日と入金金額（正の数値）は必須です")
      return
    }
    setSaving(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) { setErr("ログイン状態を確認してください"); setSaving(false); return }

      const res = await fetch(`/api/invoices/${invoiceId}/record-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ paid_at: paidAt, paid_amount: amount, payment_method: method, payment_memo: memo || null, payment_note: note || null }),
      })
      const json = await res.json().catch(() => null) as { ok?: boolean; warning?: string; error?: string } | null
      if (!res.ok) { setErr(json?.error ?? "入金の記録に失敗しました"); setSaving(false); return }
      if (json?.warning) setWarning(json.warning)
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "通信エラーが発生しました")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "var(--surface)", borderRadius: 16, padding: 28, width: "100%", maxWidth: 480, boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
        <h2 style={{ margin: "0 0 20px", fontSize: 18 }}>入金を記録</h2>
        {err && <p style={{ color: "var(--error-text)", margin: "0 0 12px", fontSize: 14 }}>{err}</p>}
        {warning && <p style={{ color: "#b45309", background: "#fef3c7", padding: "8px 12px", borderRadius: 8, margin: "0 0 12px", fontSize: 13 }}>{warning}</p>}
        <div style={{ display: "grid", gap: 14 }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>入金日 <span style={{ color: "var(--error-text)" }}>*</span></span>
            <input type="date" value={paidAt} onChange={e => setPaidAt(e.target.value)} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)" }} />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>入金金額（円） <span style={{ color: "var(--error-text)" }}>*</span></span>
            <input type="number" value={paidAmount} onChange={e => setPaidAmount(e.target.value)} min={1} step={1} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)" }} />
            <span style={{ fontSize: 12, color: "var(--muted)" }}>請求額: {formatCurrency(invoiceTotal)}</span>
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>決済方法 <span style={{ color: "var(--error-text)" }}>*</span></span>
            <select value={method} onChange={e => setMethod(e.target.value)} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)" }}>
              <option value="bank_transfer">銀行振込</option>
              <option value="cash">現金</option>
              <option value="card">クレジットカード</option>
              <option value="other">その他</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>振込名義メモ（任意）</span>
            <input type="text" value={memo} onChange={e => setMemo(e.target.value)} placeholder="例: ヤマダタロウ" style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)" }} />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>備考（任意）</span>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", resize: "vertical" }} />
          </label>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
          <button type="button" onClick={onClose} disabled={saving} style={{ padding: "9px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", cursor: "pointer" }}>キャンセル</button>
          <button type="button" onClick={() => void handleSubmit()} disabled={saving} style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: "var(--primary)", color: "#fff", fontWeight: 700, cursor: saving ? "not-allowed" : "pointer" }}>
            {saving ? "保存中..." : "入金を記録する"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── 領収書発行モーダル ────────────────────────────────────────────────────
function IssueReceiptModal({
  invoiceId,
  onClose,
  onIssued,
}: {
  invoiceId: string
  onClose: () => void
  onIssued: (receiptId: string) => void
}) {
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState("")
  const [issuing, setIssuing] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const handleIssue = async () => {
    setErr(null)
    setIssuing(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) { setErr("ログイン状態を確認してください"); setIssuing(false); return }

      const res = await fetch("/api/receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ invoice_id: invoiceId, issue_date: issueDate, note: note || null }),
      })
      const json = await res.json().catch(() => null) as { receipt?: { id: string }; error?: string; existing_receipt_id?: string } | null
      if (!res.ok) {
        setErr(json?.error ?? "領収書の発行に失敗しました")
        setIssuing(false)
        return
      }
      onIssued(json?.receipt?.id ?? "")
    } catch (e) {
      setErr(e instanceof Error ? e.message : "通信エラーが発生しました")
    } finally {
      setIssuing(false)
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "var(--surface)", borderRadius: 16, padding: 28, width: "100%", maxWidth: 460, boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
        <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>領収書を発行</h2>
        <p style={{ margin: "0 0 20px", fontSize: 13, color: "var(--muted)" }}>発行後は内容を変更できません。内容を確認してから発行してください。</p>
        {err && <p style={{ color: "var(--error-text)", margin: "0 0 12px", fontSize: 14 }}>{err}</p>}
        <div style={{ display: "grid", gap: 14 }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>発行日 <span style={{ color: "var(--error-text)" }}>*</span></span>
            <input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)" }} />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>備考（任意・PDF に記載されます）</span>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder="経費処理のための補足情報など" style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", resize: "vertical" }} />
          </label>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
          <button type="button" onClick={onClose} disabled={issuing} style={{ padding: "9px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", cursor: "pointer" }}>キャンセル</button>
          <button type="button" onClick={() => void handleIssue()} disabled={issuing} style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: "#16a34a", color: "#fff", fontWeight: 700, cursor: issuing ? "not-allowed" : "pointer" }}>
            {issuing ? "発行中（PDF生成）..." : "領収書を発行する"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── 入金ステータスラベル ─────────────────────────────────────────────────
const PAYMENT_STATUS_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  unpaid:   { label: "未入金",   color: "#92400e", bg: "#fef3c7" },
  partial:  { label: "一部入金", color: "#1d4ed8", bg: "#dbeafe" },
  paid:     { label: "入金済み", color: "#166534", bg: "#dcfce7" },
  overpaid: { label: "過入金",   color: "#7c3aed", bg: "#ede9fe" },
}

export default function InvoiceDetailPage() {
  const params = useParams()
  const id = typeof params.id === "string" ? params.id : null
  const { activeOrgId: orgId, role, loading: authLoading } = useAuthOrg({ redirectToOnboarding: true })

  const canAccess = role === "owner" || role === "executive_assistant"
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [notesDraft, setNotesDraft] = useState("")
  const [sendDraft, setSendDraft] = useState("")
  const [showRecordPayment, setShowRecordPayment] = useState(false)
  const [showIssueReceipt, setShowIssueReceipt] = useState(false)
  const [receiptLoading, setReceiptLoading] = useState(false)

  useEffect(() => {
    if (authLoading || !id || !orgId || !canAccess) {
      if (!authLoading) setLoading(false)
      return
    }
    let active = true

    const load = async () => {
      const { data, error: fetchError } = await supabase
        .from("invoices")
        .select(
          "id, org_id, client_id, invoice_month, invoice_title, invoice_no, issue_date, due_date, status, subtotal, total, tax_mode, tax_amount, withholding_enabled, withholding_amount, notes, source_type, guest_client_name, guest_company_name, guest_client_email, guest_client_address, issuer_snapshot, bank_snapshot, payment_status, paid_at, paid_amount, payment_method, payment_memo, payment_note, latest_receipt_id, public_token, client_notified_at, client_paid_at_claimed, client_paid_amount_claimed, client_transfer_name, client_notify_note, clients(name), invoice_lines(id, quantity, unit_price, amount, description, content_id, project_name, title)"
        )
        .eq("id", id)
        .eq("org_id", orgId)
        .maybeSingle()

      if (!active) return

      if (fetchError) {
        setError(`請求書詳細の取得に失敗しました: ${fetchError.message}`)
        setInvoice(null)
      } else {
        setInvoice((data as Invoice | null) ?? null)
      }

      setLoading(false)
    }

    void load()
    return () => {
      active = false
    }
  }, [authLoading, canAccess, id, orgId])

  useEffect(() => {
    setNotesDraft(invoice?.notes ?? "")
  }, [invoice?.id, invoice?.notes])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ApplyAiResultDetail>).detail
      if (detail?.source !== "billing" || !detail.result?.text) return
      if (detail.applyTarget === "invoice_detail_notes") setNotesDraft(detail.result.text)
      if (detail.applyTarget === "invoice_detail_send_draft") setSendDraft(detail.result.text)
    }

    window.addEventListener("apply-ai-result", handler as EventListener)
    return () => window.removeEventListener("apply-ai-result", handler as EventListener)
  }, [])

  const fileName = useMemo(() => (invoice ? defaultFileName(invoice) : ""), [invoice])

  const openPdf = async () => {
    if (!id) return
    const token = await getAccessToken()
    if (!token) {
      setError("ログイン状態を確認してください。")
      return
    }
    setPdfLoading(true)
    try {
      const res = await fetch(`/api/invoices/${id}/pdf`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = (await res.json().catch(() => null)) as { signed_url?: string; error?: string } | null
      if (json?.signed_url) {
        window.open(json.signed_url, "_blank", "noopener,noreferrer")
      } else {
        setError(json?.error ?? "PDF を開けませんでした。")
      }
    } finally {
      setPdfLoading(false)
    }
  }

  const copySendDraft = async () => {
    if (!sendDraft.trim()) return
    try {
      await navigator.clipboard.writeText(sendDraft)
    } catch {
      setError("送付前文のコピーに失敗しました。")
    }
  }

  const copyNotifyUrl = async () => {
    if (!invoice?.public_token) return
    try {
      await navigator.clipboard.writeText(`${resolveRuntimeAppUrl().replace(/\/$/, "")}/pay/${invoice.public_token}`)
    } catch {
      setError("支払完了通知URLのコピーに失敗しました。")
    }
  }

  const openReceipt = async (receiptId: string) => {
    if (!receiptId) return
    const token = await getAccessToken()
    if (!token) { setError("ログイン状態を確認してください。"); return }
    setReceiptLoading(true)
    try {
      const res = await fetch(`/api/receipts/${receiptId}/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json().catch(() => null) as { signed_url?: string; error?: string } | null
      if (json?.signed_url) {
        window.open(json.signed_url, "_blank", "noopener,noreferrer")
      } else {
        setError(json?.error ?? "領収書PDFを開けませんでした。")
      }
    } finally {
      setReceiptLoading(false)
    }
  }

  const reloadInvoice = async () => {
    if (!id || !orgId) return
    const { data } = await supabase
      .from("invoices")
      .select("id, org_id, client_id, invoice_month, invoice_title, invoice_no, issue_date, due_date, status, subtotal, total, tax_mode, tax_amount, withholding_enabled, withholding_amount, notes, source_type, guest_client_name, guest_company_name, guest_client_email, guest_client_address, issuer_snapshot, bank_snapshot, payment_status, paid_at, paid_amount, payment_method, payment_memo, payment_note, latest_receipt_id, public_token, client_notified_at, client_paid_at_claimed, client_paid_amount_claimed, client_transfer_name, client_notify_note, clients(name), invoice_lines(id, quantity, unit_price, amount, description, content_id, project_name, title)")
      .eq("id", id).eq("org_id", orgId).maybeSingle()
    if (data) setInvoice(data as unknown as Invoice)
  }

  if (authLoading || loading) {
    return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  }

  if (!canAccess) {
    return <div style={{ padding: 32, color: "var(--error-text)" }}>403: owner / executive_assistant のみアクセスできます。</div>
  }

  if (!invoice) {
    return (
      <div style={{ padding: 32 }}>
        <div style={cardStyle}>
          <p style={{ marginTop: 0, color: "var(--muted)" }}>{error ?? "請求書データが見つかりません。"}</p>
          <Link href="/invoices" style={{ color: "var(--primary)", fontWeight: 600 }}>
            請求書に戻る
          </Link>
        </div>
      </div>
    )
  }

  const issuer = invoice.issuer_snapshot ?? {}
  const bank = invoice.bank_snapshot ?? {}
  const counterparty = resolveInvoiceRecipientLabel({
    clientName: invoice.clients?.name,
    guestCompanyName: invoice.guest_company_name,
    guestClientName: invoice.guest_client_name,
  })
  const counterpartyNameForAi = resolveInvoiceRecipientName({
    clientName: invoice.clients?.name,
    guestCompanyName: invoice.guest_company_name,
    guestClientName: invoice.guest_client_name,
  })
  const invoiceAiContext = [
    `請求先: ${counterpartyNameForAi}`,
    `請求番号: ${invoice.invoice_no || "-"}`,
    `対象月: ${invoice.invoice_month}`,
    `請求タイトル: ${invoice.invoice_title || "-"}`,
    `発行日: ${invoice.issue_date}`,
    `支払期限: ${invoice.due_date}`,
    `合計: ${formatCurrency(invoice.total ?? invoice.subtotal)}`,
    `既存メモ: ${invoice.notes || "-"}`,
    `送付前文: ${sendDraft || "-"}`,
  ].join("\n")
  const notifyUrl = invoice.public_token
    ? `${resolveRuntimeAppUrl().replace(/\/$/, "")}/pay/${invoice.public_token}`
    : ""

  return (
    <div style={{ padding: "24px 20px 48px" }}>
      {showRecordPayment && invoice && (
        <RecordPaymentModal
          invoiceId={invoice.id}
          invoiceTotal={Number(invoice.total ?? invoice.subtotal)}
          onClose={() => setShowRecordPayment(false)}
          onSaved={() => { setShowRecordPayment(false); void reloadInvoice() }}
        />
      )}
      {showIssueReceipt && invoice && (
        <IssueReceiptModal
          invoiceId={invoice.id}
          onClose={() => setShowIssueReceipt(false)}
          onIssued={(receiptId) => { setShowIssueReceipt(false); void reloadInvoice(); void openReceipt(receiptId) }}
        />
      )}
      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, color: "var(--text)" }}>請求書詳細</h1>
            <div style={{ marginTop: 6, fontSize: 13, color: "var(--muted)" }}>
              {describeInvoiceSourceType(invoice.source_type)}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={openPdf} disabled={pdfLoading} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", cursor: "pointer" }}>
              {pdfLoading ? "PDF準備中..." : "PDFを開く"}
            </button>
            <Link href={`/invoices?month=${encodeURIComponent(invoice.invoice_month)}`} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", textDecoration: "none" }}>
              この月の一覧へ
            </Link>
          </div>
        </div>

        {error ? <p style={{ color: "var(--error-text)", marginTop: 0 }}>{error}</p> : null}

        {/* ─── 入金・領収書ステータスセクション ─── */}
        {(() => {
          const ps = invoice.payment_status ?? "unpaid"
          const statusInfo = PAYMENT_STATUS_LABEL[ps] ?? PAYMENT_STATUS_LABEL.unpaid
          const canIssueReceipt = ps === "paid" || ps === "overpaid"
          const hasReceipt = !!invoice.latest_receipt_id
          const paymentMethodLabel: Record<string, string> = {
            bank_transfer: "銀行振込", cash: "現金", card: "クレジットカード", other: "その他",
          }
          return (
            <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 20, background: "var(--surface-2)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: ps !== "unpaid" ? 14 : 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <strong style={{ fontSize: 15 }}>入金ステータス</strong>
                  <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700, color: statusInfo.color, background: statusInfo.bg }}>{statusInfo.label}</span>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" onClick={() => setShowRecordPayment(true)} style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", cursor: "pointer", fontSize: 13 }}>
                    {ps === "unpaid" ? "入金を記録" : "入金情報を更新"}
                  </button>
                  {canIssueReceipt && !hasReceipt && (
                    <button type="button" onClick={() => setShowIssueReceipt(true)} style={{ padding: "7px 14px", borderRadius: 8, border: "none", background: "#16a34a", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
                      領収書を発行
                    </button>
                  )}
                  {hasReceipt && (
                    <>
                      <button type="button" onClick={() => void openReceipt(invoice.latest_receipt_id!)} disabled={receiptLoading} style={{ padding: "7px 14px", borderRadius: 8, border: "none", background: "var(--primary)", color: "#fff", fontWeight: 700, cursor: receiptLoading ? "not-allowed" : "pointer", fontSize: 13 }}>
                        {receiptLoading ? "準備中..." : "領収書を開く"}
                      </button>
                      <Link href={`/receipts/${invoice.latest_receipt_id}`} style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", textDecoration: "none", fontSize: 13 }}>
                        領収書詳細
                      </Link>
                    </>
                  )}
                </div>
              </div>
              {ps !== "unpaid" && invoice.paid_at && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, fontSize: 13, color: "var(--muted)" }}>
                  <div><span style={{ color: "var(--text)", fontWeight: 500 }}>入金日:</span> {invoice.paid_at}</div>
                  <div><span style={{ color: "var(--text)", fontWeight: 500 }}>入金額:</span> {formatCurrency(invoice.paid_amount)}</div>
                  <div><span style={{ color: "var(--text)", fontWeight: 500 }}>決済方法:</span> {paymentMethodLabel[invoice.payment_method ?? ""] ?? invoice.payment_method ?? "-"}</div>
                  {invoice.payment_memo && <div><span style={{ color: "var(--text)", fontWeight: 500 }}>振込名義:</span> {invoice.payment_memo}</div>}
                </div>
              )}
              {canIssueReceipt && !hasReceipt && (
                <p style={{ margin: "12px 0 0", fontSize: 12, color: "#166534", background: "#dcfce7", padding: "6px 10px", borderRadius: 6 }}>
                  入金が確認されました。「領収書を発行」から経費証憑用PDFを発行できます。
                </p>
              )}
              {ps === "unpaid" && invoice.status === "issued" && (
                <p style={{ margin: "12px 0 0", fontSize: 12, color: "var(--muted)" }}>
                  入金を確認したら「入金を記録」を押してください。入金確認後に領収書を発行できます。
                </p>
              )}
            </div>
          )
        })()}

        <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 20, background: "var(--surface)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
            <div>
              <strong style={{ fontSize: 15, color: "var(--text)" }}>支払完了通知導線</strong>
              <div style={{ marginTop: 6, fontSize: 13, color: "var(--muted)" }}>
                請求書PDFに記載している振込後フォームです。必要に応じてこのURLを相手に共有できます。
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => void copyNotifyUrl()}
                disabled={!notifyUrl}
                style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", cursor: notifyUrl ? "pointer" : "not-allowed", fontSize: 13 }}
              >
                URLをコピー
              </button>
              {notifyUrl && (
                <a
                  href={notifyUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ padding: "7px 14px", borderRadius: 8, border: "none", background: "var(--primary)", color: "#fff", textDecoration: "none", fontWeight: 700, fontSize: 13 }}
                >
                  公開フォームを開く
                </a>
              )}
            </div>
          </div>

          {notifyUrl ? (
            <div style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)", fontSize: 12, color: "var(--muted)", wordBreak: "break-all", marginBottom: 12 }}>
              {notifyUrl}
            </div>
          ) : (
            <div style={{ marginBottom: 12, fontSize: 12, color: "var(--muted)" }}>
              公開フォームURLを生成できませんでした。`NEXT_PUBLIC_APP_URL` または現在の起点URLを確認してください。
            </div>
          )}

          {invoice.client_notified_at ? (
            <div style={{ borderRadius: 10, border: "1px solid #bbf7d0", background: "#f0fdf4", padding: 14, display: "grid", gap: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#166534" }}>先方から支払完了通知が届いています</div>
              <div style={{ fontSize: 13, color: "#166534" }}>通知受信: {invoice.client_notified_at}</div>
              {invoice.client_paid_at_claimed && <div style={{ fontSize: 13, color: "#166534" }}>振込日: {invoice.client_paid_at_claimed}</div>}
              {invoice.client_paid_amount_claimed != null && <div style={{ fontSize: 13, color: "#166534" }}>振込金額: {formatCurrency(invoice.client_paid_amount_claimed)}</div>}
              {invoice.client_transfer_name && <div style={{ fontSize: 13, color: "#166534" }}>振込名義: {invoice.client_transfer_name}</div>}
              {invoice.client_notify_note && <div style={{ fontSize: 13, color: "#166534" }}>備考: {invoice.client_notify_note}</div>}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              まだ支払完了通知は届いていません。PDFダウンロード後に相手がそのまま使えるよう、今回この導線を強化しています。
            </div>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 16 }}>
          <div><strong>請求先:</strong> {counterparty}</div>
          <div><strong>請求番号:</strong> {invoice.invoice_no || "-"}</div>
          <div><strong>対象月:</strong> {invoice.invoice_month}</div>
          <div><strong>請求タイトル:</strong> {invoice.invoice_title || "-"}</div>
          <div><strong>ファイル名:</strong> {fileName}</div>
          <div><strong>発行日:</strong> {invoice.issue_date}</div>
          <div><strong>支払期限:</strong> {invoice.due_date}</div>
          <div><strong>ステータス:</strong> {invoice.status}</div>
          <div><strong>小計:</strong> {formatCurrency(invoice.subtotal)}</div>
          <div><strong>税額:</strong> {formatCurrency(invoice.tax_amount)}</div>
          <div><strong>源泉徴収:</strong> {formatCurrency(invoice.withholding_amount)}</div>
          <div><strong>合計:</strong> {formatCurrency(invoice.total ?? invoice.subtotal)}</div>
        </div>

        {(invoice.guest_company_name || invoice.guest_client_name || invoice.guest_client_email || invoice.guest_client_address) && (
          <div style={{ marginBottom: 18, padding: 14, border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface-2)" }}>
            <strong style={{ display: "block", marginBottom: 8 }}>ゲスト請求先情報</strong>
            {invoice.guest_company_name && <div>会社名: {invoice.guest_company_name}</div>}
            {invoice.guest_client_name && <div>担当者名: {invoice.guest_client_name}</div>}
            {invoice.guest_client_email && <div>メール: {invoice.guest_client_email}</div>}
            {invoice.guest_client_address && <div>住所: {invoice.guest_client_address}</div>}
          </div>
        )}

        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", marginBottom: 18 }}>
          <div style={{ padding: 14, border: "1px solid var(--border)", borderRadius: 10 }}>
            <strong style={{ display: "block", marginBottom: 8 }}>発行元情報</strong>
            <div>{String(issuer.issuer_name ?? "") || "-"}</div>
            {issuer.issuer_address ? <div>{String(issuer.issuer_address)}</div> : null}
            {issuer.issuer_phone ? <div>TEL: {String(issuer.issuer_phone)}</div> : null}
            {issuer.issuer_email ? <div>Email: {String(issuer.issuer_email)}</div> : null}
            {issuer.issuer_registration_number ? <div>登録番号: {String(issuer.issuer_registration_number)}</div> : null}
          </div>
          <div style={{ padding: 14, border: "1px solid var(--border)", borderRadius: 10 }}>
            <strong style={{ display: "block", marginBottom: 8 }}>振込先情報</strong>
            <div>{String(bank.bank_name ?? "") || "-"}</div>
            {bank.branch_name ? <div>{String(bank.branch_name)}</div> : null}
            {bank.account_type && bank.account_number ? (
              <div>
                {String(bank.account_type)} / {String(bank.account_number)}
              </div>
            ) : null}
            {bank.account_holder ? <div>{String(bank.account_holder)}</div> : null}
            {bank.depositor_code ? <div>振込人コード: {String(bank.depositor_code)}</div> : null}
          </div>
        </div>

        <h2 style={{ fontSize: 16, marginBottom: 8 }}>請求明細</h2>
        <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead>
              <tr style={{ background: "var(--surface-2)", color: "var(--text)" }}>
                {["プロジェクト", "タイトル", "数量", "単価", "金額", "元コンテンツ"].map((label) => (
                  <th key={label} style={{ textAlign: "left", padding: 10, fontSize: 13 }}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(invoice.invoice_lines ?? []).map((line) => (
                <tr key={line.id} style={{ borderTop: "1px solid var(--border)", color: "var(--text)" }}>
                  <td style={{ padding: 10, fontSize: 13 }}>{line.project_name || "-"}</td>
                  <td style={{ padding: 10, fontSize: 13 }}>{line.title || line.description || "-"}</td>
                  <td style={{ padding: 10, fontSize: 13 }}>{line.quantity}</td>
                  <td style={{ padding: 10, fontSize: 13 }}>{formatCurrency(line.unit_price)}</td>
                  <td style={{ padding: 10, fontSize: 13 }}>{formatCurrency(line.amount)}</td>
                  <td style={{ padding: 10, fontSize: 13 }}>
                    {line.content_id ? (
                      <Link href={`/contents?highlight=${encodeURIComponent(line.content_id)}`} style={{ color: "var(--primary)", fontWeight: 600 }}>
                        /contents で確認
                      </Link>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}
              {(invoice.invoice_lines ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: 14, fontSize: 13, color: "var(--muted)" }}>
                    明細はありません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 18, display: "grid", gap: 16 }}>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
              <h2 style={{ fontSize: 16, margin: 0 }}>メモ下書き</h2>
              <button
                type="button"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("open-ai-palette", {
                      detail: {
                        source: "billing" as const,
                        mode: "rewrite" as const,
                        modes: ["rewrite", "format", "request_message"],
                        text: notesDraft,
                        compareText: notesDraft,
                        context: invoiceAiContext,
                        title: "Billing AI",
                        applyLabel: "メモ下書きに反映",
                        applyTarget: "invoice_detail_notes",
                        meta: {
                          sourceObject: "invoice",
                          recordId: invoice.id,
                          recordLabel: invoice.invoice_no || invoice.invoice_title || invoice.invoice_month,
                        },
                      },
                    })
                  )
                }
                style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", cursor: "pointer", fontWeight: 700 }}
              >
                AIメモ整形
              </button>
            </div>
            <textarea
              value={notesDraft}
              onChange={(event) => setNotesDraft(event.target.value)}
              rows={4}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)", resize: "vertical", boxSizing: "border-box" }}
            />
            <div style={{ marginTop: 6, fontSize: 12, color: "var(--muted)" }}>この欄はローカル下書きです。既存の請求書データ自体は更新しません。</div>
          </div>

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
              <h2 style={{ fontSize: 16, margin: 0 }}>送付前文ドラフト</h2>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent("open-ai-palette", {
                        detail: {
                          source: "billing" as const,
                          mode: "send_message" as const,
                          text: sendDraft,
                          compareText: sendDraft,
                          context: invoiceAiContext,
                          title: "Billing AI",
                          applyLabel: "送付前文に反映",
                          applyTarget: "invoice_detail_send_draft",
                          meta: {
                            sourceObject: "invoice",
                            recordId: invoice.id,
                            recordLabel: invoice.invoice_no || invoice.invoice_title || invoice.invoice_month,
                          },
                        },
                      })
                    )
                  }
                  style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", cursor: "pointer", fontWeight: 700 }}
                >
                  AI送付文生成
                </button>
                <button
                  type="button"
                  onClick={() => void copySendDraft()}
                  disabled={!sendDraft.trim()}
                  style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", cursor: sendDraft.trim() ? "pointer" : "not-allowed", fontWeight: 700 }}
                >
                  コピー
                </button>
              </div>
            </div>
            <textarea
              value={sendDraft}
              onChange={(event) => setSendDraft(event.target.value)}
              rows={4}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)", resize: "vertical", boxSizing: "border-box" }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
