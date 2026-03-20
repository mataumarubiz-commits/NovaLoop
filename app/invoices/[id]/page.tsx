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
  boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
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
          "id, org_id, client_id, invoice_month, invoice_title, invoice_no, issue_date, due_date, status, subtotal, total, tax_mode, tax_amount, withholding_enabled, withholding_amount, notes, source_type, guest_client_name, guest_company_name, guest_client_email, guest_client_address, issuer_snapshot, bank_snapshot, clients(name), invoice_lines(id, quantity, unit_price, amount, description, content_id, project_name, title)"
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

  if (authLoading || loading) {
    return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  }

  if (!canAccess) {
    return <div style={{ padding: 32, color: "#b91c1c" }}>403: owner / executive_assistant のみアクセスできます。</div>
  }

  if (!invoice) {
    return (
      <div style={{ padding: 32 }}>
        <div style={cardStyle}>
          <p style={{ marginTop: 0, color: "var(--muted)" }}>{error ?? "請求書データが見つかりません。"}</p>
          <Link href="/invoices" style={{ color: "var(--primary)", fontWeight: 600 }}>
            請求書一覧に戻る
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

  return (
    <div style={{ padding: "24px 20px 48px" }}>
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

        {error ? <p style={{ color: "#b91c1c", marginTop: 0 }}>{error}</p> : null}

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
