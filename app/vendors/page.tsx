"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react"
import GuideEmptyState from "@/components/shared/GuideEmptyState"
import { useAuthOrg } from "@/hooks/useAuthOrg"
import { supabase } from "@/lib/supabase"

type VendorRow = {
  id: string
  name: string
  email: string | null
  notes: string | null
  is_active: boolean
  vendor_portal_invited_at?: string | null
  vendor_portal_invited_email?: string | null
}

type VendorUserRow = { vendor_id: string }
type ProfileRow = { vendor_id: string }
type BankRow = { vendor_id: string }
type InvoiceRow = {
  id: string
  vendor_id: string
  billing_month: string
  status: string
  total: number
  submitted_at: string | null
  request_sent_at?: string | null
}

type BatchSummary = {
  totalVendors: number
  created: number
  updated: number
  empty: number
  locked: number
}

const cardStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 16,
  padding: 18,
  background: "var(--surface)",
  boxShadow: "0 10px 30px rgba(15,23,42,0.06)",
}

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--input-bg)",
  color: "var(--input-text)",
}

const primaryButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "none",
  background: "var(--button-primary-bg)",
  color: "var(--primary-contrast)",
  fontWeight: 700,
  cursor: "pointer",
}

const secondaryButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
  fontWeight: 700,
  cursor: "pointer",
}

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

function registrationState(params: { invitedAt?: string | null; hasJoined: boolean; hasProfile: boolean; hasBank: boolean }) {
  if (params.hasBank) return "口座登録済み"
  if (params.hasProfile) return "プロフィール登録済み"
  if (params.hasJoined) return "参加済み"
  if (params.invitedAt) return "招待送信済み"
  return "未招待"
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

function fmtDate(value?: string | null) {
  return value ? value.slice(0, 10) : "-"
}

function formatYen(value: number) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(Number(value || 0))
}

export default function VendorsPage() {
  const { activeOrgId: orgId, role, loading: authLoading } = useAuthOrg({ redirectToOnboarding: true })
  const [loading, setLoading] = useState(true)
  const [vendors, setVendors] = useState<VendorRow[]>([])
  const [vendorUsers, setVendorUsers] = useState<VendorUserRow[]>([])
  const [profiles, setProfiles] = useState<ProfileRow[]>([])
  const [banks, setBanks] = useState<BankRow[]>([])
  const [currentInvoices, setCurrentInvoices] = useState<InvoiceRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [notes, setNotes] = useState("")
  const [month, setMonth] = useState(currentMonth())
  const [batchSummary, setBatchSummary] = useState<BatchSummary | null>(null)

  const canAccess = role === "owner" || role === "executive_assistant"

  const load = useCallback(async () => {
    if (!orgId || !canAccess) return
    setLoading(true)
    setError(null)

    const [vendorRes, vendorUserRes, profileRes, bankRes, invoiceRes] = await Promise.all([
      supabase
        .from("vendors")
        .select("id, name, email, notes, is_active, vendor_portal_invited_at, vendor_portal_invited_email")
        .eq("org_id", orgId)
        .order("name"),
      supabase.from("vendor_users").select("vendor_id").eq("org_id", orgId),
      supabase.from("vendor_profiles").select("vendor_id").eq("org_id", orgId),
      supabase.from("vendor_bank_accounts").select("vendor_id").eq("org_id", orgId).eq("is_default", true),
      supabase
        .from("vendor_invoices")
        .select("id, vendor_id, billing_month, status, total, submitted_at, request_sent_at")
        .eq("org_id", orgId)
        .eq("billing_month", month),
    ])

    if (vendorRes.error) {
      setError(`外注先一覧の取得に失敗しました: ${vendorRes.error.message}`)
      setVendors([])
      setLoading(false)
      return
    }

    setVendors((vendorRes.data ?? []) as VendorRow[])
    setVendorUsers((vendorUserRes.data ?? []) as VendorUserRow[])
    setProfiles((profileRes.data ?? []) as ProfileRow[])
    setBanks((bankRes.data ?? []) as BankRow[])
    setCurrentInvoices((invoiceRes.data ?? []) as InvoiceRow[])
    setLoading(false)
  }, [canAccess, month, orgId])

  useEffect(() => {
    if (!orgId || !canAccess) {
      setLoading(false)
      return
    }
    void load()
  }, [canAccess, load, orgId])

  const vendorUserSet = useMemo(() => new Set(vendorUsers.map((row) => row.vendor_id)), [vendorUsers])
  const profileSet = useMemo(() => new Set(profiles.map((row) => row.vendor_id)), [profiles])
  const bankSet = useMemo(() => new Set(banks.map((row) => row.vendor_id)), [banks])
  const invoiceByVendor = useMemo(() => new Map(currentInvoices.map((row) => [row.vendor_id, row])), [currentInvoices])

  const callAdminApi = async (path: string, body: Record<string, unknown>) => {
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

  const handleAdd = async () => {
    if (!orgId || !name.trim()) return
    setAdding(true)
    setError(null)
    try {
      const { error: insertError } = await supabase.from("vendors").insert({
        org_id: orgId,
        name: name.trim(),
        email: email.trim() || null,
        notes: notes.trim() || null,
        is_active: true,
      })
      if (insertError) {
        setError(`外注先の追加に失敗しました: ${insertError.message}`)
        return
      }
      setName("")
      setEmail("")
      setNotes("")
      await load()
    } finally {
      setAdding(false)
    }
  }

  const handleInvite = async (vendor: VendorRow) => {
    if (!vendor.email) {
      setError("招待前にメールアドレスを登録してください")
      return
    }
    setBusyKey(`invite:${vendor.id}`)
    setError(null)
    try {
      const json = await callAdminApi("/api/vendors/invite", { vendorId: vendor.id, email: vendor.email })
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

  const handleCopyPortal = async () => {
    if (!navigator.clipboard?.writeText) return
    await navigator.clipboard.writeText(`${window.location.origin}/vendor`)
  }

  const handleRequestInvoice = async (vendorId: string) => {
    setBusyKey(`request:${vendorId}`)
    setError(null)
    try {
      await callAdminApi("/api/vendors/request-invoice", { vendorId, month })
      await load()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "請求依頼の送信に失敗しました")
    } finally {
      setBusyKey(null)
    }
  }

  const handleBatch = async (mode: "draft" | "request") => {
    setBusyKey(`batch:${mode}`)
    setError(null)
    setBatchSummary(null)
    try {
      const json = await callAdminApi("/api/vendors/generate-monthly", { month, mode })
      setBatchSummary((json?.summary ?? null) as BatchSummary | null)
      await load()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "月次処理に失敗しました")
    } finally {
      setBusyKey(null)
    }
  }

  if (authLoading || loading) return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  if (!canAccess) return <div style={{ padding: 32, color: "var(--muted)" }}>owner / executive_assistant のみ利用できます。</div>

  return (
    <div style={{ padding: "32px 40px 60px", minHeight: "100vh", background: "var(--bg-grad)" }}>
      <div style={{ maxWidth: 1220, margin: "0 auto", display: "grid", gap: 16 }}>
        <header style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "end" }}>
          <div>
            <p style={{ fontSize: 12, letterSpacing: "0.08em", color: "var(--muted)", margin: 0 }}>VENDORS</p>
            <h1 style={{ fontSize: 28, margin: "6px 0 8px", color: "var(--text)" }}>外注先一覧</h1>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>
              招待、請求依頼、承認前の状態確認、Payouts への接続までをここから進めます。
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/payouts" style={{ ...secondaryButtonStyle, textDecoration: "none" }}>
              Payouts を開く
            </Link>
            <Link href="/help/vendors-payouts" style={{ ...secondaryButtonStyle, textDecoration: "none" }}>
              使い方を見る
            </Link>
          </div>
        </header>

        {error ? <section style={{ ...cardStyle, borderColor: "#fecaca", background: "#fff1f2", color: "#b91c1c" }}>{error}</section> : null}

        <section style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>当月の請求依頼をまとめて準備</h2>
              <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 13 }}>
                対象月の draft 組み立てだけ先に行うか、そのまま請求依頼まで送るかを選べます。
              </p>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={inputStyle} />
              <button type="button" onClick={() => void handleBatch("draft")} disabled={busyKey === "batch:draft"} style={secondaryButtonStyle}>
                下書きを作成
              </button>
              <button type="button" onClick={() => void handleBatch("request")} disabled={busyKey === "batch:request"} style={primaryButtonStyle}>
                依頼まで送る
              </button>
            </div>
          </div>
          {batchSummary ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginTop: 14 }}>
              <SummaryCard label="対象外注先" value={String(batchSummary.totalVendors)} />
              <SummaryCard label="新規作成" value={String(batchSummary.created)} />
              <SummaryCard label="更新" value={String(batchSummary.updated)} />
              <SummaryCard label="対象なし" value={String(batchSummary.empty)} />
              <SummaryCard label="ロック中" value={String(batchSummary.locked)} />
            </div>
          ) : null}
        </section>

        <section style={cardStyle}>
          <h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>外注先を追加</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginTop: 14 }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="外注先名" style={inputStyle} />
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="メールアドレス" style={inputStyle} />
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="メモ" style={inputStyle} />
            <button type="button" onClick={() => void handleAdd()} disabled={adding || !name.trim()} style={primaryButtonStyle}>
              {adding ? "追加中..." : "外注先を追加"}
            </button>
          </div>
        </section>

        <section style={cardStyle}>
          {vendors.length === 0 ? (
            <GuideEmptyState
              title="外注先はまだありません"
              description="先に外注先を登録すると、ポータル招待、請求依頼、支払処理まで同じ導線で進められます。"
              primaryHref="/help/vendors-payouts"
              primaryLabel="運用フローを見る"
              helpHref="/payouts"
              helpLabel="Payouts を開く"
            />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1080 }}>
                <thead>
                  <tr>
                    {["外注先", "招待状態", "登録状態", "当月請求", "提出日", "金額", "操作"].map((label) => (
                      <th key={label} style={thStyle}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {vendors.map((vendor) => {
                    const invoice = invoiceByVendor.get(vendor.id)
                    const registration = registrationState({
                      invitedAt: vendor.vendor_portal_invited_at,
                      hasJoined: vendorUserSet.has(vendor.id),
                      hasProfile: profileSet.has(vendor.id),
                      hasBank: bankSet.has(vendor.id),
                    })
                    return (
                      <tr key={vendor.id}>
                        <td style={tdStyle}>
                          <div style={{ display: "grid", gap: 4 }}>
                            <Link href={`/vendors/${vendor.id}`} style={{ color: "var(--primary)", fontWeight: 700, textDecoration: "none" }}>
                              {vendor.name}
                            </Link>
                            <span style={{ color: "var(--muted)", fontSize: 12 }}>{vendor.email || "メール未登録"}</span>
                          </div>
                        </td>
                        <td style={tdStyle}>
                          <div style={{ display: "grid", gap: 4 }}>
                            <span>{vendor.vendor_portal_invited_at ? "送信済み" : "未送信"}</span>
                            <span style={{ color: "var(--muted)", fontSize: 12 }}>{fmtDate(vendor.vendor_portal_invited_at)}</span>
                          </div>
                        </td>
                        <td style={tdStyle}>{registration}</td>
                        <td style={tdStyle}>
                          <div style={{ display: "grid", gap: 4 }}>
                            <span>{invoiceStateLabel(invoice?.status)}</span>
                            <span style={{ color: "var(--muted)", fontSize: 12 }}>
                              {invoice?.request_sent_at ? `依頼送信: ${fmtDate(invoice.request_sent_at)}` : "依頼未送信"}
                            </span>
                          </div>
                        </td>
                        <td style={tdStyle}>{fmtDate(invoice?.submitted_at)}</td>
                        <td style={tdStyle}>{invoice ? formatYen(invoice.total) : "-"}</td>
                        <td style={tdStyle}>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button type="button" onClick={() => void handleInvite(vendor)} disabled={busyKey === `invite:${vendor.id}`} style={secondaryButtonStyle}>
                              招待
                            </button>
                            <button type="button" onClick={() => void handleRequestInvoice(vendor.id)} disabled={busyKey === `request:${vendor.id}`} style={secondaryButtonStyle}>
                              請求依頼
                            </button>
                            <Link href={`/vendors/${vendor.id}`} style={{ ...secondaryButtonStyle, textDecoration: "none" }}>
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
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
            <button type="button" onClick={() => void handleCopyPortal()} style={secondaryButtonStyle}>
              ポータルURLをコピー
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface-2)" }}>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>{value}</div>
    </div>
  )
}

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  borderBottom: "1px solid var(--table-border)",
  color: "var(--muted)",
  fontSize: 12,
  fontWeight: 600,
}

const tdStyle: CSSProperties = {
  padding: "12px",
  borderBottom: "1px solid var(--table-border)",
  color: "var(--text)",
  verticalAlign: "top",
}
