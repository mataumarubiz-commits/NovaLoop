"use client"

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useAuthOrg } from "@/hooks/useAuthOrg"

const RETURN_CATEGORIES = [
  ["profile_missing", "プロフィール情報の不足"],
  ["bank_invalid", "口座情報の不備"],
  ["memo_required", "備考追記が必要"],
  ["content_review", "対象案件の確認が必要"],
  ["other", "その他"],
] as const

const STATUS_LABELS: Record<string, string> = {
  draft: "確認待ち",
  submitted: "提出済み",
  approved: "承認済み",
  rejected: "差し戻し",
  paid: "支払済み",
}

type InvoiceRow = {
  id: string
  billing_month: string
  status: string
  submit_deadline: string
  pay_date: string
  total: number
  pdf_path: string | null
  memo: string | null
  item_count: number
  rejected_category: string | null
  rejected_reason: string | null
  submitted_at: string | null
  first_submitted_at: string | null
  resubmitted_at: string | null
  confirmed_at: string | null
  returned_at: string | null
  return_count: number
  return_history: Array<{ category?: string; reason?: string; returned_at?: string }>
  vendor_profile_snapshot: Record<string, unknown> | null
  vendor_bank_snapshot: Record<string, unknown> | null
}

type VendorRow = { id: string; name: string; email: string | null }
type LineRow = { id: string; content_id: string | null; work_type: string | null; description: string | null; qty: number; unit_price: number; amount: number }

const cardStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 14,
  padding: 18,
  background: "var(--surface)",
  boxShadow: "0 2px 10px rgba(15,23,42,0.04)",
}

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--input-bg)",
}

function yen(value: number) {
  return `¥${new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(Number(value || 0))}`
}

function fmt(v?: string | null) {
  return v ? new Date(v).toLocaleString("ja-JP") : "-"
}

function categoryLabel(value?: string | null) {
  return RETURN_CATEGORIES.find(([k]) => k === value)?.[1] ?? value ?? "-"
}

export default function VendorInvoiceDetailPage() {
  const params = useParams()
  const vendorId = typeof params?.id === "string" ? params.id : null
  const invoiceId = typeof params?.invoiceId === "string" ? params.invoiceId : null
  const { activeOrgId, role, loading: authLoading } = useAuthOrg({ redirectToOnboarding: true })
  const [loading, setLoading] = useState(true)
  const [invoice, setInvoice] = useState<InvoiceRow | null>(null)
  const [vendor, setVendor] = useState<VendorRow | null>(null)
  const [lines, setLines] = useState<LineRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [rejectCategory, setRejectCategory] = useState("profile_missing")
  const [rejectReason, setRejectReason] = useState("")

  const canAccess = role === "owner" || role === "executive_assistant"

  const load = useCallback(async () => {
    if (!activeOrgId || !canAccess || !invoiceId || !vendorId) return
    setLoading(true)
    const [invoiceRes, vendorRes, linesRes] = await Promise.all([
      supabase.from("vendor_invoices").select("id, billing_month, status, submit_deadline, pay_date, total, pdf_path, memo, item_count, rejected_category, rejected_reason, submitted_at, first_submitted_at, resubmitted_at, confirmed_at, returned_at, return_count, return_history, vendor_profile_snapshot, vendor_bank_snapshot").eq("id", invoiceId).eq("org_id", activeOrgId).maybeSingle(),
      supabase.from("vendors").select("id, name, email").eq("id", vendorId).eq("org_id", activeOrgId).maybeSingle(),
      supabase.from("vendor_invoice_lines").select("id, content_id, work_type, description, qty, unit_price, amount").eq("vendor_invoice_id", invoiceId),
    ])

    if (invoiceRes.error || !invoiceRes.data) {
      setError("外注請求の読み込みに失敗しました。")
      setLoading(false)
      return
    }

    const nextInvoice = invoiceRes.data as InvoiceRow
    setInvoice(nextInvoice)
    setVendor((vendorRes.data ?? null) as VendorRow | null)
    setLines((linesRes.data ?? []) as LineRow[])
    setRejectCategory(nextInvoice.rejected_category ?? "profile_missing")
    setRejectReason(nextInvoice.rejected_reason ?? "")
    setLoading(false)
  }, [activeOrgId, canAccess, invoiceId, vendorId])

  useEffect(() => {
    void load()
  }, [load])

  const total = useMemo(() => lines.reduce((sum, line) => sum + Number(line.amount), 0), [lines])
  const profileSnapshot = invoice?.vendor_profile_snapshot ?? {}
  const bankSnapshot = invoice?.vendor_bank_snapshot ?? {}

  const openPdf = async () => {
    if (!invoiceId) return
    const token = (await supabase.auth.getSession()).data.session?.access_token
    if (!token) {
      setError("ログインし直してください。")
      return
    }
    const res = await fetch(`/api/vendor-invoices/${invoiceId}/pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const json = (await res.json().catch(() => null)) as { signed_url?: string; error?: string } | null
    if (!res.ok || !json?.signed_url) {
      setError(json?.error ?? "PDFを開けませんでした。")
      return
    }
    window.open(json.signed_url, "_blank", "noopener,noreferrer")
  }

  const review = async (action: "approve" | "reject") => {
    if (!invoiceId) return
    setBusy(true)
    setError(null)
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token
      if (!token) throw new Error("ログインし直してください。")
      const res = await fetch(`/api/vendor-invoices/${invoiceId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, category: rejectCategory, reason: rejectReason }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "レビュー更新に失敗しました。")
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "レビュー更新に失敗しました。")
    } finally {
      setBusy(false)
    }
  }

  if (authLoading || loading) return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  if (!canAccess) return <div style={{ padding: 32, color: "var(--muted)" }}>owner / executive_assistant のみ利用できます。</div>
  if (!invoice || !vendor) return <div style={{ padding: 32, color: "var(--muted)" }}>外注請求が見つかりません。</div>

  return (
    <div style={{ padding: "32px 40px 60px", minHeight: "100vh", background: "var(--bg-grad)" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", display: "grid", gap: 16 }}>
        <header style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "start" }}>
          <div>
            <Link href={`/vendors/${vendorId}`} style={{ fontSize: 14, color: "var(--primary)", fontWeight: 600, textDecoration: "none" }}>
              {vendor.name}
            </Link>
            <h1 style={{ fontSize: 28, margin: "12px 0 8px", color: "var(--text)" }}>外注請求 {invoice.billing_month}</h1>
            <p style={{ margin: 0, fontSize: 14, color: "var(--muted)" }}>
              状態: {STATUS_LABELS[invoice.status] ?? invoice.status} / 初回提出 {fmt(invoice.first_submitted_at || invoice.submitted_at)} / 最終再提出 {fmt(invoice.resubmitted_at)}
            </p>
          </div>
          <button type="button" onClick={() => void openPdf()} style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)" }}>
            PDFを開く
          </button>
        </header>

        {error ? <section style={{ ...cardStyle, borderColor: "#fecaca", background: "#fff1f2", color: "#b91c1c" }}>{error}</section> : null}

        <section style={{ ...cardStyle, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <Info title="外注名" value={vendor.name} sub={vendor.email || "メール未登録"} />
          <Info title="請求合計" value={yen(total)} sub={`${invoice.item_count ?? lines.length}件`} />
          <Info title="差し戻し回数" value={String(invoice.return_count ?? 0)} sub={`差し戻し日 ${fmt(invoice.returned_at)}`} />
          <Info title="承認日 / 支払日" value={fmt(invoice.confirmed_at)} sub={`支払予定 ${invoice.pay_date || "-"}`} />
        </section>

        {invoice.status === "rejected" ? (
          <section style={{ ...cardStyle, borderColor: "#fdba74", background: "#fff7ed" }}>
            <h2 style={{ margin: 0, fontSize: 18, color: "#9a3412" }}>現在の差し戻し内容</h2>
            <div style={{ display: "grid", gap: 8, marginTop: 14, color: "#9a3412" }}>
              <div>カテゴリ: {categoryLabel(invoice.rejected_category)}</div>
              <div>理由: {invoice.rejected_reason || "-"}</div>
            </div>
          </section>
        ) : null}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
          <section style={cardStyle}>
            <h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>請求者情報 snapshot</h2>
            <div style={{ marginTop: 14, display: "grid", gap: 8, fontSize: 14, color: "var(--text)" }}>
              <div>表示名: {String(profileSnapshot.display_name ?? "-")}</div>
              <div>請求者情報: {String(profileSnapshot.billing_name ?? "-")}</div>
              <div>メール: {String(profileSnapshot.email ?? "-")}</div>
              <div>住所: {String(profileSnapshot.address ?? "-")}</div>
            </div>
          </section>

          <section style={cardStyle}>
            <h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>口座情報 snapshot</h2>
            <div style={{ marginTop: 14, display: "grid", gap: 8, fontSize: 14, color: "var(--text)" }}>
              <div>銀行名: {String(bankSnapshot.bank_name ?? "-")}</div>
              <div>支店名: {String(bankSnapshot.branch_name ?? "-")}</div>
              <div>口座番号: {String(bankSnapshot.account_number ?? "-")}</div>
              <div>口座名義: {String(bankSnapshot.account_holder ?? "-")}</div>
            </div>
          </section>
        </div>

        <section style={cardStyle}>
          <h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>請求明細</h2>
          <div style={{ marginTop: 14, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={thStyle}>作業内容</th>
                  <th style={thRight}>数量</th>
                  <th style={thRight}>単価</th>
                  <th style={thRight}>小計</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.id}>
                    <td style={tdStyle}>
                      <div>{line.description || line.work_type || "-"}</div>
                      {line.content_id ? (
                        <div style={{ marginTop: 4, fontSize: 12 }}>
                          <Link href={`/contents?highlight=${line.content_id}`} style={{ color: "var(--primary)", textDecoration: "none" }}>
                            元案件を開く
                          </Link>
                        </div>
                      ) : null}
                    </td>
                    <td style={tdRight}>{line.qty}</td>
                    <td style={tdRight}>{yen(line.unit_price)}</td>
                    <td style={{ ...tdRight, fontWeight: 600 }}>{yen(line.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section style={cardStyle}>
          <h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>会社側レビュー</h2>
          <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--muted)" }}>
            差し戻し時はカテゴリと理由を入力してください。修正再提出でも請求IDは変わりません。
          </p>
          <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>差し戻しカテゴリ</span>
              <select value={rejectCategory} onChange={(e) => setRejectCategory(e.target.value)} style={inputStyle}>
                {RETURN_CATEGORIES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>差し戻し理由</span>
              <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={4} style={{ ...inputStyle, resize: "vertical" }} />
            </label>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
            <button type="button" onClick={() => void review("approve")} disabled={busy || invoice.status === "approved" || invoice.status === "paid"} style={{ padding: "9px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)" }}>
              承認する
            </button>
            <button type="button" onClick={() => void review("reject")} disabled={busy} style={{ padding: "9px 14px", borderRadius: 10, border: "1px solid #fdba74", background: "#fff7ed", color: "#9a3412" }}>
              差し戻す
            </button>
          </div>
        </section>

        {(invoice.return_history?.length ?? 0) > 0 ? (
          <section style={cardStyle}>
            <h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>差し戻し履歴</h2>
            <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
              {invoice.return_history.map((row, index) => (
                <div key={`${row.returned_at ?? index}`} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>#{index + 1} / {fmt(row.returned_at)}</div>
                  <div style={{ marginTop: 6, fontWeight: 700, color: "var(--text)" }}>{categoryLabel(row.category)}</div>
                  <div style={{ marginTop: 6, color: "var(--muted)" }}>{row.reason || "-"}</div>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}

function Info({ title, value, sub }: { title: string; value: string; sub: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{title}</div>
      <div style={{ marginTop: 6, fontSize: 18, fontWeight: 700, color: "var(--text)" }}>{value}</div>
      <div style={{ marginTop: 6, fontSize: 13, color: "var(--muted)" }}>{sub}</div>
    </div>
  )
}

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "10px 8px",
  borderBottom: "1px solid var(--border)",
  color: "var(--muted)",
}

const thRight: CSSProperties = {
  ...thStyle,
  textAlign: "right",
}

const tdStyle: CSSProperties = {
  padding: "10px 8px",
  borderBottom: "1px solid var(--table-border)",
  color: "var(--text)",
}

const tdRight: CSSProperties = {
  ...tdStyle,
  textAlign: "right",
}
