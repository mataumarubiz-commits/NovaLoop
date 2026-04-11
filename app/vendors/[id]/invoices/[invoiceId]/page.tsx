"use client"

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useAuthOrg } from "@/hooks/useAuthOrg"
import type { ApplyAiResultDetail } from "@/lib/aiClientEvents"
import { selectWithColumnFallback } from "@/lib/postgrestCompat"

const RETURN_CATEGORIES = [
  ["profile_missing", "プロフィール不足"],
  ["bank_invalid", "口座情報不足"],
  ["memo_required", "補足メモが必要"],
  ["content_review", "制作内容の確認不足"],
  ["other", "その他"],
] as const

const STATUS_LABELS: Record<string, string> = {
  draft: "確認前",
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
  item_count?: number
  rejected_category?: string | null
  rejected_reason?: string | null
  submitted_at?: string | null
  first_submitted_at?: string | null
  resubmitted_at?: string | null
  approved_at?: string | null
  confirmed_at?: string | null
  returned_at?: string | null
  return_count?: number
  return_history?: Array<{ category?: string; reason?: string; returned_at?: string }>
  vendor_profile_snapshot?: Record<string, unknown> | null
  vendor_bank_snapshot?: Record<string, unknown> | null
}

type VendorRow = { id: string; name: string; email: string | null }
type LineRow = { id: string; content_id: string | null; work_type: string | null; description: string | null; qty: number; unit_price: number; amount: number }
type EvidenceRow = { id: string; file_name: string; storage_path: string; mime_type: string | null; file_size: number | null; created_at: string }

const cardStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 14,
  padding: 18,
  background: "var(--surface)",
  boxShadow: "var(--shadow-sm)",
}

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--input-bg)",
  boxSizing: "border-box",
}

function yen(value: number) {
  return new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(Number(value || 0))
}

function fmt(value?: string | null) {
  return value ? new Date(value).toLocaleString("ja-JP") : "-"
}

function categoryLabel(value?: string | null) {
  return RETURN_CATEGORIES.find(([key]) => key === value)?.[1] ?? value ?? "-"
}

function safeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, "_")
}

function formatBytes(value?: number | null) {
  if (!value) return "-"
  if (value >= 1024 * 1024) return `${Math.round((value / (1024 * 1024)) * 10) / 10} MB`
  if (value >= 1024) return `${Math.round(value / 102.4) / 10} KB`
  return `${value} B`
}

export default function VendorInvoiceDetailPage() {
  const params = useParams()
  const vendorId = typeof params?.id === "string" ? params.id : null
  const invoiceId = typeof params?.invoiceId === "string" ? params.invoiceId : null
  const { activeOrgId, role, user, loading: authLoading } = useAuthOrg({ redirectToOnboarding: true })

  const canAccess = role === "owner" || role === "executive_assistant"
  const [loading, setLoading] = useState(true)
  const [invoice, setInvoice] = useState<InvoiceRow | null>(null)
  const [vendor, setVendor] = useState<VendorRow | null>(null)
  const [lines, setLines] = useState<LineRow[]>([])
  const [evidenceFiles, setEvidenceFiles] = useState<EvidenceRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploadBusy, setUploadBusy] = useState(false)
  const [rejectCategory, setRejectCategory] = useState("profile_missing")
  const [rejectReason, setRejectReason] = useState("")
  const [memoDraft, setMemoDraft] = useState("")

  const load = useCallback(async () => {
    if (!activeOrgId || !canAccess || !invoiceId || !vendorId) return
    setLoading(true)
    setError(null)

    try {
      const [invoiceRes, vendorRes, linesRes, evidenceRes] = await Promise.all([
        selectWithColumnFallback<InvoiceRow>({
          table: "vendor_invoices",
          columns: [
            "id",
            "billing_month",
            "status",
            "submit_deadline",
            "pay_date",
            "total",
            "pdf_path",
            "memo",
            "item_count",
            "rejected_category",
            "rejected_reason",
            "submitted_at",
            "first_submitted_at",
            "resubmitted_at",
            "approved_at",
            "confirmed_at",
            "returned_at",
            "return_count",
            "return_history",
            "vendor_profile_snapshot",
            "vendor_bank_snapshot",
          ],
          execute: async (columnsCsv) => {
            const result = await supabase
              .from("vendor_invoices")
              .select(columnsCsv)
              .eq("id", invoiceId)
              .eq("org_id", activeOrgId)
              .maybeSingle()
            return {
              data: (result.data ?? null) as InvoiceRow | null,
              error: result.error,
            }
          },
        }),
        supabase.from("vendors").select("id, name, email").eq("id", vendorId).eq("org_id", activeOrgId).maybeSingle(),
        supabase.from("vendor_invoice_lines").select("id, content_id, work_type, description, qty, unit_price, amount").eq("vendor_invoice_id", invoiceId),
        supabase
          .from("vendor_invoice_evidence_files")
          .select("id, file_name, storage_path, mime_type, file_size, created_at")
          .eq("vendor_invoice_id", invoiceId)
          .order("created_at", { ascending: false }),
      ])

      if (!invoiceRes.data) {
        setError("外注請求の取得に失敗しました。")
        return
      }

      const nextInvoice = invoiceRes.data
      setInvoice(nextInvoice)
      setVendor((vendorRes.data ?? null) as VendorRow | null)
      setLines((linesRes.data ?? []) as LineRow[])
      setEvidenceFiles((evidenceRes.data ?? []) as EvidenceRow[])
      setRejectCategory(nextInvoice.rejected_category ?? "profile_missing")
      setRejectReason(nextInvoice.rejected_reason ?? "")
      setMemoDraft(nextInvoice.memo ?? "")
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "外注請求の取得に失敗しました。")
      setInvoice(null)
      setVendor(null)
      setLines([])
      setEvidenceFiles([])
    } finally {
      setLoading(false)
    }
  }, [activeOrgId, canAccess, invoiceId, vendorId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ApplyAiResultDetail>).detail
      if (detail?.source !== "vendor" || !detail.result?.text) return
      if (detail.applyTarget === "vendor_invoice_reject_reason") setRejectReason(detail.result.text)
      if (detail.applyTarget === "vendor_invoice_memo_draft") setMemoDraft(detail.result.text)
    }

    window.addEventListener("apply-ai-result", handler as EventListener)
    return () => window.removeEventListener("apply-ai-result", handler as EventListener)
  }, [])

  const total = useMemo(() => lines.reduce((sum, line) => sum + Number(line.amount), 0), [lines])
  const profileSnapshot = invoice?.vendor_profile_snapshot ?? {}
  const bankSnapshot = invoice?.vendor_bank_snapshot ?? {}

  const rejectAiContext = useMemo(
    () =>
      [
        `ベンダー: ${vendor?.name ?? "-"}`,
        `対象月: ${invoice?.billing_month ?? "-"}`,
        `ステータス: ${invoice?.status ?? "-"}`,
        `金額: ${invoice ? yen(invoice.total) : "-"}`,
        `差し戻し回数: ${invoice?.return_count ?? 0}`,
        `差し戻しカテゴリ: ${categoryLabel(rejectCategory)}`,
        `現在の理由: ${rejectReason || invoice?.rejected_reason || "-"}`,
      ].join("\n"),
    [invoice, rejectCategory, rejectReason, vendor?.name]
  )

  const memoAiContext = useMemo(() => {
    const lineSummary =
      lines.map((line) => `${line.description || line.work_type || "-"} / 数量 ${line.qty} / 金額 ${yen(line.amount)}`).join("\n") || "-"

    return [
      `ベンダー: ${vendor?.name ?? "-"}`,
      `対象月: ${invoice?.billing_month ?? "-"}`,
      `ステータス: ${invoice?.status ?? "-"}`,
      `提出期限: ${invoice?.submit_deadline ?? "-"}`,
      `金額: ${invoice ? yen(invoice.total) : "-"}`,
      `既存メモ: ${invoice?.memo || "-"}`,
      `明細:\n${lineSummary}`,
    ].join("\n")
  }, [invoice, lines, vendor?.name])

  const openPdf = async () => {
    if (!invoiceId) return
    const token = (await supabase.auth.getSession()).data.session?.access_token
    if (!token) {
      setError("ログイン状態を確認してください。")
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
      if (!token) throw new Error("ログイン状態を確認してください。")
      const res = await fetch(`/api/vendor-invoices/${invoiceId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, category: rejectCategory, reason: rejectReason }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "レビュー更新に失敗しました。")
      await load()
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "レビュー更新に失敗しました。")
    } finally {
      setBusy(false)
    }
  }

  const copyMemoDraft = async () => {
    if (!memoDraft.trim()) return
    try {
      await navigator.clipboard.writeText(memoDraft)
    } catch {
      setError("メモをコピーできませんでした。")
    }
  }

  const uploadEvidence = async (file: File | null) => {
    if (!file || !activeOrgId || !invoiceId || !user?.id) return
    setUploadBusy(true)
    setError(null)
    try {
      const safeName = `${Date.now()}-${safeFileName(file.name)}`
      const storagePath = `org/${activeOrgId}/vendor-invoices/${invoiceId}/${safeName}`
      const { error: uploadError } = await supabase.storage.from("vendor-invoice-evidence").upload(storagePath, file, {
        upsert: false,
        contentType: file.type || "application/octet-stream",
      })
      if (uploadError) throw uploadError

      const { error: insertError } = await supabase.from("vendor_invoice_evidence_files").insert({
        org_id: activeOrgId,
        vendor_invoice_id: invoiceId,
        file_name: file.name,
        storage_path: storagePath,
        mime_type: file.type || null,
        file_size: file.size,
        created_by: user.id,
      })
      if (insertError) throw insertError

      await load()
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "証憑ファイルの保存に失敗しました。")
    } finally {
      setUploadBusy(false)
    }
  }

  const openEvidence = async (row: EvidenceRow) => {
    const { data, error: signedError } = await supabase.storage
      .from("vendor-invoice-evidence")
      .createSignedUrl(row.storage_path, 60 * 10)

    if (signedError || !data?.signedUrl) {
      setError(signedError?.message ?? "証憑を開けませんでした。")
      return
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer")
  }

  const deleteEvidence = async (row: EvidenceRow) => {
    if (!window.confirm(`${row.file_name} を削除しますか。`)) return
    setUploadBusy(true)
    setError(null)
    try {
      const { error: storageError } = await supabase.storage.from("vendor-invoice-evidence").remove([row.storage_path])
      if (storageError) throw storageError
      const { error: deleteError } = await supabase.from("vendor_invoice_evidence_files").delete().eq("id", row.id)
      if (deleteError) throw deleteError
      await load()
    } catch (deleteErr) {
      setError(deleteErr instanceof Error ? deleteErr.message : "証憑の削除に失敗しました。")
    } finally {
      setUploadBusy(false)
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
              状態: {STATUS_LABELS[invoice.status] ?? invoice.status} / 初回提出: {fmt(invoice.first_submitted_at || invoice.submitted_at)} / 最終再提出: {fmt(invoice.resubmitted_at)}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => void openPdf()} style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)" }}>
              PDFを開く
            </button>
            <Link href={`/documents?tab=vendor&month=${encodeURIComponent(invoice.billing_month)}`} style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", textDecoration: "none" }}>
              請求書保管
            </Link>
          </div>
        </header>

        {error ? <section style={{ ...cardStyle, borderColor: "var(--error-border)", background: "var(--error-bg)", color: "var(--error-text)" }}>{error}</section> : null}

        <section style={{ ...cardStyle, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <Info title="ベンダー" value={vendor.name} sub={vendor.email || "メール未登録"} />
          <Info title="請求金額" value={yen(total)} sub={`${invoice.item_count ?? lines.length}行`} />
          <Info title="差し戻し回数" value={String(invoice.return_count ?? 0)} sub={`最終差し戻し ${fmt(invoice.returned_at)}`} />
          <Info title="承認日 / 支払日" value={fmt(invoice.confirmed_at ?? invoice.approved_at)} sub={`支払予定 ${invoice.pay_date || "-"}`} />
        </section>

        {invoice.status === "rejected" ? (
          <section style={{ ...cardStyle, borderColor: "var(--warning-border)", background: "var(--warning-bg)" }}>
            <h2 style={{ margin: 0, fontSize: 18, color: "var(--warning-text)" }}>直近の差し戻し理由</h2>
            <div style={{ display: "grid", gap: 8, marginTop: 14, color: "var(--warning-text)" }}>
              <div>カテゴリ: {categoryLabel(invoice.rejected_category)}</div>
              <div>理由: {invoice.rejected_reason || "-"}</div>
            </div>
          </section>
        ) : null}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
          <section style={cardStyle}>
            <h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>プロフィール snapshot</h2>
            <div style={{ marginTop: 14, display: "grid", gap: 8, fontSize: 14, color: "var(--text)" }}>
              <div>表示名: {String(profileSnapshot.display_name ?? "-")}</div>
              <div>請求名義: {String(profileSnapshot.billing_name ?? "-")}</div>
              <div>メール: {String(profileSnapshot.email ?? "-")}</div>
              <div>住所: {String(profileSnapshot.address ?? "-")}</div>
            </div>
          </section>

          <section style={cardStyle}>
            <h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>口座 snapshot</h2>
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
                  <th style={thStyle}>内容</th>
                  <th style={thRight}>数量</th>
                  <th style={thRight}>単価</th>
                  <th style={thRight}>金額</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.id}>
                    <td style={tdStyle}>
                      <div>{line.description || line.work_type || "-"}</div>
                      {line.content_id ? (
                        <div style={{ marginTop: 4, fontSize: 12 }}>
                          <Link href={`/projects?highlight=${encodeURIComponent(line.content_id)}`} style={{ color: "var(--primary)", textDecoration: "none" }}>
                            案件で開く
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
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>証憑添付</h2>
              <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)" }}>
                原本PDFや補足証憑をここで管理します。支払判断に必要なファイルだけを集約します。
              </p>
            </div>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)", cursor: uploadBusy ? "wait" : "pointer" }}>
              <span>{uploadBusy ? "アップロード中..." : "ファイルを追加"}</span>
              <input type="file" style={{ display: "none" }} disabled={uploadBusy} onChange={(event) => void uploadEvidence(event.target.files?.[0] ?? null)} />
            </label>
          </div>

          {evidenceFiles.length === 0 ? (
            <div style={{ marginTop: 14, color: "var(--muted)" }}>まだ証憑はありません。</div>
          ) : (
            <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
              {evidenceFiles.map((row) => (
                <div key={row.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
                  <div>
                    <div style={{ fontWeight: 700, color: "var(--text)" }}>{row.file_name}</div>
                    <div style={{ marginTop: 4, fontSize: 13, color: "var(--muted)" }}>
                      {row.mime_type || "-"} / {formatBytes(row.file_size)} / {fmt(row.created_at)}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" onClick={() => void openEvidence(row)} style={secondaryButtonStyle}>
                      開く
                    </button>
                    <button type="button" onClick={() => void deleteEvidence(row)} disabled={uploadBusy} style={secondaryButtonStyle}>
                      削除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>メモ草案</h2>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("open-ai-palette", {
                      detail: {
                        source: "vendor" as const,
                        mode: "rewrite" as const,
                        modes: ["rewrite", "format"],
                        text: memoDraft,
                        compareText: memoDraft,
                        context: memoAiContext,
                        title: "Vendor Billing AI",
                        applyLabel: "メモ草案に反映",
                        applyTarget: "vendor_invoice_memo_draft",
                        meta: {
                          sourceObject: "vendor_invoice",
                          recordId: invoice.id,
                          recordLabel: `${vendor.name} ${invoice.billing_month}`,
                        },
                      },
                    })
                  )
                }
                style={secondaryButtonStyle}
              >
                AIで整える
              </button>
              <button type="button" onClick={() => void copyMemoDraft()} disabled={!memoDraft.trim()} style={secondaryButtonStyle}>
                コピー
              </button>
            </div>
          </div>
          <textarea value={memoDraft} onChange={(event) => setMemoDraft(event.target.value)} rows={6} style={{ ...inputStyle, marginTop: 14, resize: "vertical" }} />
        </section>

        <section style={cardStyle}>
          <div style={{ display: "grid", gap: 14 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>レビュー</h2>
              <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)" }}>
                承認か差し戻しかをここで確定します。
              </p>
            </div>
            <label style={{ display: "grid", gap: 6 }}>
              <span>差し戻しカテゴリ</span>
              <select value={rejectCategory} onChange={(event) => setRejectCategory(event.target.value)} style={inputStyle}>
                {RETURN_CATEGORIES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 14, color: "var(--text)", fontWeight: 600 }}>差し戻し理由</span>
              <button
                type="button"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("open-ai-palette", {
                      detail: {
                        source: "vendor" as const,
                        mode: "rewrite" as const,
                        modes: ["rewrite", "format"],
                        text: rejectReason,
                        compareText: rejectReason,
                        context: rejectAiContext,
                        title: "Vendor Billing AI",
                        applyLabel: "差し戻し理由に反映",
                        applyTarget: "vendor_invoice_reject_reason",
                        meta: {
                          sourceObject: "vendor_invoice",
                          recordId: invoice.id,
                          recordLabel: `${vendor.name} ${invoice.billing_month}`,
                        },
                      },
                    })
                  )
                }
                style={secondaryButtonStyle}
              >
                AIで整える
              </button>
            </div>
            <textarea value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} rows={4} style={{ ...inputStyle, resize: "vertical" }} />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={() => void review("approve")} disabled={busy} style={primaryButtonStyle}>
                {busy ? "更新中..." : "承認する"}
              </button>
              <button type="button" onClick={() => void review("reject")} disabled={busy || !rejectReason.trim()} style={secondaryButtonStyle}>
                差し戻す
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

function Info({ title, value, sub }: { title: string; value: string; sub: string }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface-2)" }}>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{title}</div>
      <div style={{ marginTop: 6, fontSize: 22, fontWeight: 700, color: "var(--text)" }}>{value}</div>
      <div style={{ marginTop: 6, fontSize: 12, color: "var(--muted)" }}>{sub}</div>
    </div>
  )
}

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  borderBottom: "1px solid var(--border)",
  color: "var(--muted)",
  fontSize: 12,
}

const tdStyle: CSSProperties = {
  padding: "12px",
  borderBottom: "1px solid var(--border)",
  color: "var(--text)",
  verticalAlign: "top",
}

const thRight: CSSProperties = {
  ...thStyle,
  textAlign: "right",
}

const tdRight: CSSProperties = {
  ...tdStyle,
  textAlign: "right",
}

const secondaryButtonStyle: CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--surface-2)",
  color: "var(--text)",
  fontWeight: 700,
  cursor: "pointer",
}

const primaryButtonStyle: CSSProperties = {
  ...secondaryButtonStyle,
  borderColor: "var(--button-primary-bg)",
  background: "var(--button-primary-bg)",
  color: "var(--primary-contrast)",
}
