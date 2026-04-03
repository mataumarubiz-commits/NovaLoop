"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react"
import { useParams } from "next/navigation"
import type { ApplyAiResultDetail } from "@/lib/aiClientEvents"
import { selectWithColumnFallback } from "@/lib/postgrestCompat"
import { supabase } from "@/lib/supabase"
import { useAuthOrg } from "@/hooks/useAuthOrg"

type VendorRow = {
  id: string
  name: string
  email: string | null
  notes: string | null
  is_active: boolean
  vendor_portal_invited_at?: string | null
}

type VendorInvoiceRow = {
  id: string
  billing_month: string
  status: string
  pay_date: string | null
  total: number
  rejected_reason: string | null
  submitted_at: string | null
  first_submitted_at?: string | null
  resubmitted_at?: string | null
  return_count?: number
}

type VendorProfileRow = {
  display_name: string | null
  billing_name: string | null
}

type VendorBankRow = {
  bank_name: string | null
  branch_name: string | null
  account_type: string | null
  account_number: string | null
  account_holder: string | null
}

type VendorUserRow = { vendor_id: string }

const cardStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 16,
  padding: 18,
  background: "var(--surface)",
  boxShadow: "var(--shadow-md)",
}

const buttonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
  fontWeight: 700,
  cursor: "pointer",
}

function currentMonth() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

function invoiceStateLabel(status?: string | null) {
  switch (status) {
    case "draft":
      return "下書き"
    case "submitted":
      return "提出済み"
    case "approved":
      return "承認済み"
    case "rejected":
      return "差し戻し"
    case "paid":
      return "支払済み"
    default:
      return "未作成"
  }
}

function yen(value: number) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(Number(value || 0))
}

function fmtDate(value?: string | null) {
  return value ? value.slice(0, 10) : "-"
}

function maskAccount(value?: string | null) {
  if (!value) return "-"
  return `****${value.slice(-4)}`
}

function buildRejectAiContext(vendorName: string, invoice: VendorInvoiceRow | null) {
  return [
    `外注名: ${vendorName}`,
    `対象月: ${invoice?.billing_month ?? "-"}`,
    `請求ステータス: ${invoice?.status ?? "-"}`,
    `請求額: ${invoice?.total ?? 0}`,
    `差し戻し回数: ${invoice?.return_count ?? 0}`,
    `前回理由: ${invoice?.rejected_reason ?? "-"}`,
  ].join("\n")
}

export default function VendorDetailPage() {
  const params = useParams()
  const id = typeof params?.id === "string" ? params.id : null
  const { activeOrgId, role, loading: authLoading } = useAuthOrg({ redirectToOnboarding: true })
  const [loading, setLoading] = useState(true)
  const [vendor, setVendor] = useState<VendorRow | null>(null)
  const [invoices, setInvoices] = useState<VendorInvoiceRow[]>([])
  const [profile, setProfile] = useState<VendorProfileRow | null>(null)
  const [bank, setBank] = useState<VendorBankRow | null>(null)
  const [vendorUser, setVendorUser] = useState<VendorUserRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReasonDraft, setRejectReasonDraft] = useState("")
  const month = currentMonth()
  const canAccess = role === "owner" || role === "executive_assistant"

  const load = useCallback(async () => {
    if (!id || !activeOrgId || !canAccess) return
    setLoading(true)
    setError(null)

    try {
      const [vendorRes, invoiceRes, profileRes, bankRes, vendorUserRes] = await Promise.all([
        supabase
          .from("vendors")
          .select("id, name, email, notes, is_active, vendor_portal_invited_at")
          .eq("id", id)
          .eq("org_id", activeOrgId)
          .maybeSingle(),
        selectWithColumnFallback<VendorInvoiceRow[]>({
          table: "vendor_invoices",
          columns: [
            "id",
            "billing_month",
            "status",
            "pay_date",
            "total",
            "rejected_reason",
            "submitted_at",
            "first_submitted_at",
            "resubmitted_at",
            "return_count",
          ],
          execute: async (columnsCsv) => {
            const result = await supabase
              .from("vendor_invoices")
              .select(columnsCsv)
              .eq("vendor_id", id)
              .eq("org_id", activeOrgId)
              .order("billing_month", { ascending: false })
            return {
              data: (result.data ?? []) as unknown as VendorInvoiceRow[],
              error: result.error,
            }
          },
        }),
        supabase.from("vendor_profiles").select("display_name, billing_name").eq("vendor_id", id).eq("org_id", activeOrgId).maybeSingle(),
        supabase
          .from("vendor_bank_accounts")
          .select("bank_name, branch_name, account_type, account_number, account_holder")
          .eq("vendor_id", id)
          .eq("org_id", activeOrgId)
          .eq("is_default", true)
          .maybeSingle(),
        supabase.from("vendor_users").select("vendor_id").eq("vendor_id", id).eq("org_id", activeOrgId).maybeSingle(),
      ])

      if (vendorRes.error || !vendorRes.data) {
        setError("外注詳細の読み込みに失敗しました。")
        return
      }

      setVendor(vendorRes.data as VendorRow)
      setInvoices(invoiceRes.data ?? [])
      setProfile((profileRes.data ?? null) as VendorProfileRow | null)
      setBank((bankRes.data ?? null) as VendorBankRow | null)
      setVendorUser((vendorUserRes.data ?? null) as VendorUserRow | null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "外注詳細の読み込みに失敗しました。")
      setVendor(null)
      setInvoices([])
      setProfile(null)
      setBank(null)
      setVendorUser(null)
    } finally {
      setLoading(false)
    }
  }, [activeOrgId, canAccess, id])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ApplyAiResultDetail>).detail
      if (detail?.source !== "vendor" || detail.applyTarget !== "vendor_reject_reason" || !detail.result?.text) return
      setRejectReasonDraft(detail.result.text)
      setRejectOpen(true)
    }

    window.addEventListener("apply-ai-result", handler as EventListener)
    return () => window.removeEventListener("apply-ai-result", handler as EventListener)
  }, [])

  const currentInvoice = useMemo(() => invoices.find((invoice) => invoice.billing_month === month) ?? invoices[0] ?? null, [invoices, month])

  const callApi = async (path: string, body: Record<string, unknown>) => {
    const token = (await supabase.auth.getSession()).data.session?.access_token
    if (!token) throw new Error("ログイン状態を確認してください")
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) throw new Error(json?.error ?? "処理に失敗しました")
    return json
  }

  const handleInvite = async () => {
    if (!vendor?.email) {
      setError("招待前にメールアドレスを登録してください")
      return
    }
    setBusyKey("invite")
    setError(null)
    try {
      const json = await callApi("/api/vendors/invite", { vendorId: vendor.id, email: vendor.email })
      if (json?.portalUrl && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(json.portalUrl)
      }
      await load()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "招待に失敗しました")
    } finally {
      setBusyKey(null)
    }
  }

  const handleRequest = async () => {
    if (!vendor) return
    setBusyKey("request")
    setError(null)
    try {
      await callApi("/api/vendors/request-invoice", { vendorId: vendor.id, month })
      await load()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "請求依頼の送信に失敗しました")
    } finally {
      setBusyKey(null)
    }
  }

  const handleApprove = async () => {
    if (!currentInvoice) return
    setBusyKey("approve")
    setError(null)
    try {
      await callApi(`/api/vendor-invoices/${currentInvoice.id}/review`, { action: "approve" })
      await load()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "承認に失敗しました")
    } finally {
      setBusyKey(null)
    }
  }

  const openRejectComposer = () => {
    setRejectReasonDraft(currentInvoice?.rejected_reason ?? "")
    setRejectOpen(true)
  }

  const handleReject = async () => {
    if (!currentInvoice) return
    const reason = rejectReasonDraft.trim()
    if (!reason) {
      setError("差し戻し理由を入力してください")
      return
    }

    setBusyKey("reject")
    setError(null)
    try {
      await callApi(`/api/vendor-invoices/${currentInvoice.id}/review`, { action: "reject", category: "other", reason })
      setRejectOpen(false)
      await load()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "差し戻しに失敗しました")
    } finally {
      setBusyKey(null)
    }
  }

  const handleAddPayout = async () => {
    if (!currentInvoice) return
    setBusyKey("payout")
    setError(null)
    try {
      await callApi("/api/payouts/bulk-update", {
        orgId: activeOrgId,
        invoiceIds: [currentInvoice.id],
        status: currentInvoice.status === "paid" ? "paid" : "approved",
      })
      await load()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Payout 連携に失敗しました")
    } finally {
      setBusyKey(null)
    }
  }

  if (authLoading || loading) return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  if (!canAccess) return <div style={{ padding: 32, color: "var(--muted)" }}>owner / executive_assistant のみ利用できます。</div>
  if (!vendor) return <div style={{ padding: 32, color: "var(--muted)" }}>外注が見つかりません。</div>

  return (
    <div style={{ padding: "32px 40px 60px", minHeight: "100vh", background: "var(--bg-grad)" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", display: "grid", gap: 16 }}>
        <header style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "end" }}>
          <div>
            <Link href="/vendors" style={{ color: "var(--primary)", textDecoration: "none", fontWeight: 700 }}>
              外注一覧へ
            </Link>
            <h1 style={{ fontSize: 28, margin: "10px 0 8px", color: "var(--text)" }}>{vendor.name}</h1>
            <p style={{ margin: 0, color: "var(--muted)" }}>{vendor.email || "メール未登録"}</p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/payouts" style={{ ...buttonStyle, textDecoration: "none" }}>
              Payouts
            </Link>
            <Link href={`/documents?tab=vendor${currentInvoice?.billing_month ? `&month=${encodeURIComponent(currentInvoice.billing_month)}` : ""}`} style={{ ...buttonStyle, textDecoration: "none" }}>
              請求書保管
            </Link>
            <Link href="/help/vendors-payouts" style={{ ...buttonStyle, textDecoration: "none" }}>
              使い方
            </Link>
          </div>
        </header>

        {error ? <section style={{ ...cardStyle, borderColor: "var(--error-border)", background: "var(--error-bg)", color: "var(--error-text)" }}>{error}</section> : null}

        <section style={{ ...cardStyle, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
          <SummaryBlock label="招待状態" value={vendorUser ? "登録済み" : vendor.vendor_portal_invited_at ? "招待済み" : "未招待"} />
          <SummaryBlock label="プロフィール" value={profile?.billing_name ? "登録済み" : vendorUser ? "登録途中" : "未登録"} />
          <SummaryBlock label="振込先" value={bank?.bank_name ? "登録済み" : "未登録"} />
          <SummaryBlock label="当月請求" value={invoiceStateLabel(currentInvoice?.status)} />
        </section>

        <section style={cardStyle}>
          <h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>操作</h2>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
            <button type="button" onClick={() => void handleInvite()} disabled={busyKey === "invite"} style={buttonStyle}>
              招待を送る
            </button>
            <button type="button" onClick={() => void handleRequest()} disabled={busyKey === "request"} style={buttonStyle}>
              請求依頼を送る
            </button>
            <button type="button" onClick={() => void handleApprove()} disabled={!currentInvoice || busyKey === "approve"} style={buttonStyle}>
              承認
            </button>
            <button type="button" onClick={openRejectComposer} disabled={!currentInvoice || busyKey === "reject"} style={buttonStyle}>
              差し戻し
            </button>
            <button type="button" onClick={() => void handleAddPayout()} disabled={!currentInvoice || busyKey === "payout"} style={buttonStyle}>
              Payout へ渡す
            </button>
          </div>
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
          <section style={cardStyle}>
            <h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>外注情報</h2>
            <dl style={{ display: "grid", gap: 10, marginTop: 14 }}>
              <InfoRow label="外注名" value={vendor.name} />
              <InfoRow label="メール" value={vendor.email || "-"} />
              <InfoRow label="メモ" value={vendor.notes || "-"} />
              <InfoRow label="招待日" value={fmtDate(vendor.vendor_portal_invited_at)} />
            </dl>
          </section>

          <section style={cardStyle}>
            <h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>登録情報</h2>
            <dl style={{ display: "grid", gap: 10, marginTop: 14 }}>
              <InfoRow label="表示名" value={profile?.display_name || "-"} />
              <InfoRow label="請求名義" value={profile?.billing_name || "-"} />
              <InfoRow label="銀行名" value={bank?.bank_name || "-"} />
              <InfoRow label="支店名" value={bank?.branch_name || "-"} />
              <InfoRow label="口座種別" value={bank?.account_type || "-"} />
              <InfoRow label="口座番号" value={maskAccount(bank?.account_number)} />
              <InfoRow label="口座名義" value={bank?.account_holder || "-"} />
            </dl>
          </section>
        </section>

        <section style={cardStyle}>
          <h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>最新請求</h2>
          <dl style={{ display: "grid", gap: 10, marginTop: 14 }}>
            <InfoRow label="対象月" value={currentInvoice?.billing_month || month} />
            <InfoRow label="ステータス" value={invoiceStateLabel(currentInvoice?.status)} />
            <InfoRow label="金額" value={currentInvoice ? yen(currentInvoice.total) : "-"} />
            <InfoRow label="初回提出日" value={fmtDate(currentInvoice?.first_submitted_at || currentInvoice?.submitted_at)} />
            <InfoRow label="再提出日" value={fmtDate(currentInvoice?.resubmitted_at)} />
            <InfoRow label="差し戻し回数" value={String(currentInvoice?.return_count ?? 0)} />
            <InfoRow label="差し戻し理由" value={currentInvoice?.rejected_reason || "-"} />
          </dl>
          {currentInvoice ? (
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 14 }}>
              <Link href={`/vendors/${vendor.id}/invoices/${currentInvoice.id}`} style={{ color: "var(--primary)", fontWeight: 700, textDecoration: "none" }}>
                詳細を見る
              </Link>
              <Link href={`/documents?tab=vendor&month=${encodeURIComponent(currentInvoice.billing_month)}`} style={{ color: "var(--primary)", fontWeight: 700, textDecoration: "none" }}>
                請求書保管で見る
              </Link>
            </div>
          ) : null}
        </section>

        <section style={cardStyle}>
          <h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>請求履歴</h2>
          <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
            {invoices.length === 0 ? (
              <div style={{ border: "1px dashed var(--border)", borderRadius: 12, padding: 14, color: "var(--muted)" }}>
                請求履歴はまだありません。
              </div>
            ) : (
              invoices.map((invoice) => (
                <Link
                  key={invoice.id}
                  href={`/vendors/${vendor.id}/invoices/${invoice.id}`}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    padding: 14,
                    textDecoration: "none",
                    color: "inherit",
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <strong style={{ color: "var(--text)" }}>{invoice.billing_month}</strong>
                      <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 999, background: "rgba(37,99,235,0.08)", color: "var(--text)" }}>
                        {invoiceStateLabel(invoice.status)}
                      </span>
                    </div>
                    <div style={{ marginTop: 6, fontSize: 13, color: "var(--muted)" }}>
                      提出日 {fmtDate(invoice.submitted_at)} / 支払予定日 {fmtDate(invoice.pay_date)}
                    </div>
                  </div>
                  <div style={{ fontWeight: 700, color: "var(--text)" }}>{yen(invoice.total)}</div>
                </Link>
              ))
            )}
          </div>
        </section>
      </div>

      {rejectOpen && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setRejectOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.42)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            zIndex: 70,
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "min(720px, 100%)",
              borderRadius: 18,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              boxShadow: "var(--shadow-lg)",
              padding: 20,
              display: "grid",
              gap: 14,
            }}
          >
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>{vendor.name} / {currentInvoice?.billing_month ?? month}</div>
              <h2 style={{ margin: 0, fontSize: 22, color: "var(--text)" }}>差し戻し理由を確認</h2>
            </div>

            <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.7 }}>
              AI整形は文面の下書きだけです。実際の差し戻しは下の「差し戻しを確定」で送信されます。
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("open-ai-palette", {
                      detail: {
                        source: "vendor" as const,
                        mode: "reject_reason" as const,
                        text: rejectReasonDraft,
                        compareText: rejectReasonDraft,
                        context: buildRejectAiContext(vendor.name, currentInvoice),
                        title: "Vendor Billing AI",
                        applyLabel: "差し戻し文面に反映",
                        applyTarget: "vendor_reject_reason",
                        meta: {
                          sourceObject: "vendor_invoice",
                          recordId: currentInvoice?.id ?? vendor.id,
                          recordLabel: `${vendor.name} / ${currentInvoice?.billing_month ?? month}`,
                        },
                      },
                    })
                  )
                }
                style={buttonStyle}
              >
                AI整形
              </button>
            </div>

            <textarea
              value={rejectReasonDraft}
              onChange={(event) => setRejectReasonDraft(event.target.value)}
              rows={8}
              placeholder="差し戻し理由を入力"
              style={{
                width: "100%",
                borderRadius: 12,
                border: "1px solid var(--input-border)",
                background: "var(--input-bg)",
                color: "var(--input-text)",
                padding: 12,
                resize: "vertical",
                boxSizing: "border-box",
              }}
            />

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
              <button type="button" onClick={() => setRejectOpen(false)} style={buttonStyle}>
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => void handleReject()}
                disabled={busyKey === "reject" || !rejectReasonDraft.trim()}
                style={{
                  ...buttonStyle,
                  border: "1px solid var(--button-primary-bg)",
                  background: "var(--button-primary-bg)",
                  color: "var(--primary-contrast)",
                  cursor: busyKey === "reject" || !rejectReasonDraft.trim() ? "not-allowed" : "pointer",
                }}
              >
                {busyKey === "reject" ? "送信中..." : "差し戻しを確定"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryBlock({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14, background: "var(--surface-2)" }}>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", marginTop: 4 }}>{value}</div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <dt style={{ fontSize: 12, color: "var(--muted)" }}>{label}</dt>
      <dd style={{ margin: 0, fontWeight: 600, color: "var(--text)" }}>{value}</dd>
    </div>
  )
}
