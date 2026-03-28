"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react"
import ChecklistReturnButton from "@/components/home/ChecklistReturnButton"
import GuideEmptyState from "@/components/shared/GuideEmptyState"
import VendorSubmitLinkDialog from "@/components/vendor/VendorSubmitLinkDialog"
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
type InvoiceReminderLog = {
  id: string
  vendor_invoice_id: string | null
  reminder_type: string
  created_at: string
}
type InvoiceRow = {
  id: string
  vendor_id: string
  billing_month: string
  status: string
  total: number
  submitted_at: string | null
  submit_deadline?: string | null
  pay_date?: string | null
  rejected_reason?: string | null
  return_count?: number
  request_sent_at?: string | null
  reminder_logs?: InvoiceReminderLog[]
}

type BatchSummary = {
  totalVendors: number
  created: number
  updated: number
  empty: number
  locked: number
}

type VendorLedgerStatusFilter = "all" | "no_request" | "draft" | "submitted" | "approved" | "rejected" | "paid"
type VendorLedgerDeadlineFilter = "all" | "overdue" | "soon" | "scheduled" | "unset"

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

const dangerButtonStyle: CSSProperties = {
  ...secondaryButtonStyle,
  border: "1px solid var(--error-border)",
  color: "var(--error-text)",
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

function vendorDeadlineState(deadline?: string | null) {
  if (!deadline) return { label: "期限未設定", color: "var(--muted)", bg: "rgba(148,163,184,0.14)" }
  const today = new Date()
  const base = new Date(`${deadline}T00:00:00`)
  const diff = Math.round((base.getTime() - new Date(today.toISOString().slice(0, 10)).getTime()) / 86400000)
  if (diff < 0) return { label: "期限超過", color: "#b91c1c", bg: "#fee2e2" }
  if (diff <= 3) return { label: "期限が近い", color: "#b45309", bg: "#fef3c7" }
  return { label: "進行中", color: "#166534", bg: "#dcfce7" }
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
  const [requestMessage, setRequestMessage] = useState<string | null>(null)
  const [vendorSearch, setVendorSearch] = useState("")
  const [ledgerStatusFilter, setLedgerStatusFilter] = useState<VendorLedgerStatusFilter>("all")
  const [ledgerDeadlineFilter, setLedgerDeadlineFilter] = useState<VendorLedgerDeadlineFilter>("all")
  const [submitLinkVendor, setSubmitLinkVendor] = useState<{ id: string; name: string } | null>(null)

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
        .eq("is_active", true)
        .order("name"),
      supabase.from("vendor_users").select("vendor_id").eq("org_id", orgId),
      supabase.from("vendor_profiles").select("vendor_id").eq("org_id", orgId),
      supabase.from("vendor_bank_accounts").select("vendor_id").eq("org_id", orgId).eq("is_default", true),
      supabase
        .from("vendor_invoices")
        .select("id, vendor_id, billing_month, status, total, submitted_at, request_sent_at, submit_deadline, pay_date, rejected_reason, return_count")
        .eq("org_id", orgId)
        .eq("billing_month", month),
    ])

    if (vendorRes.error) {
      setError(`外注先一覧の取得に失敗しました: ${vendorRes.error.message}`)
      setVendors([])
      setLoading(false)
      return
    }

    const invoiceRows = (invoiceRes.data ?? []) as InvoiceRow[]
    let reminderLogs: InvoiceReminderLog[] = []
    if (invoiceRows.length > 0) {
      const { data: reminderData, error: reminderError } = await supabase
        .from("invoice_reminder_logs")
        .select("id, vendor_invoice_id, reminder_type, created_at")
        .eq("org_id", orgId)
        .in("vendor_invoice_id", invoiceRows.map((row) => row.id))
        .order("created_at", { ascending: false })
        .limit(200)
      if (reminderError) {
        setError(`依頼履歴の取得に失敗しました: ${reminderError.message}`)
      } else {
        reminderLogs = (reminderData ?? []) as InvoiceReminderLog[]
      }
    }

    const reminderLogsByInvoiceId = new Map<string, InvoiceReminderLog[]>()
    for (const log of reminderLogs) {
      if (!log.vendor_invoice_id) continue
      const list = reminderLogsByInvoiceId.get(log.vendor_invoice_id) ?? []
      list.push(log)
      reminderLogsByInvoiceId.set(log.vendor_invoice_id, list)
    }

    setVendors((vendorRes.data ?? []) as VendorRow[])
    setVendorUsers((vendorUserRes.data ?? []) as VendorUserRow[])
    setProfiles((profileRes.data ?? []) as ProfileRow[])
    setBanks((bankRes.data ?? []) as BankRow[])
    setCurrentInvoices(invoiceRows.map((row) => ({ ...row, reminder_logs: reminderLogsByInvoiceId.get(row.id) ?? [] })))
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
  const vendorTableRows = useMemo(() => {
    const query = vendorSearch.trim().toLowerCase()
    return vendors.filter((vendor) => {
      if (!query) return true
      return [vendor.name, vendor.email, vendor.notes].filter(Boolean).join(" ").toLowerCase().includes(query)
    })
  }, [vendorSearch, vendors])
  const vendorLedgerRows = useMemo(() => {
    const query = vendorSearch.trim().toLowerCase()
    return vendors
      .map((vendor) => {
        const invoice = invoiceByVendor.get(vendor.id) ?? null
        const deadlineState = vendorDeadlineState(invoice?.submit_deadline)
        const deadlineKey =
          deadlineState.label === "期限超過"
            ? "overdue"
            : deadlineState.label === "期限が近い"
              ? "soon"
              : deadlineState.label === "期限未設定"
                ? "unset"
                : "scheduled"
        return {
          vendor,
          invoice,
          bankReady: bankSet.has(vendor.id),
          deadlineState,
          deadlineKey,
          latestReminder: invoice?.reminder_logs?.[0] ?? null,
        }
      })
      .filter((row) => {
        const haystack = [row.vendor.name, row.vendor.email, row.vendor.notes, row.invoice?.rejected_reason].filter(Boolean).join(" ").toLowerCase()
        const matchesQuery = !query || haystack.includes(query)
        const matchesStatus =
          ledgerStatusFilter === "all" ||
          (ledgerStatusFilter === "no_request" ? !row.invoice : row.invoice?.status === ledgerStatusFilter)
        const matchesDeadline = ledgerDeadlineFilter === "all" || row.deadlineKey === ledgerDeadlineFilter
        return matchesQuery && matchesStatus && matchesDeadline
      })
  }, [bankSet, invoiceByVendor, ledgerDeadlineFilter, ledgerStatusFilter, vendorSearch, vendors])
  const vendorMetrics = useMemo(
    () => ({
      invited: vendors.filter((vendor) => Boolean(vendor.vendor_portal_invited_at)).length,
      requested: currentInvoices.filter((invoice) => Boolean(invoice.request_sent_at)).length,
      actionNeeded: currentInvoices.filter((invoice) => invoice.status === "draft" || invoice.status === "rejected").length,
      bankMissing: vendors.filter((vendor) => !bankSet.has(vendor.id)).length,
    }),
    [bankSet, currentInvoices, vendors]
  )

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

  const callAdminApiDelete = async (path: string) => {
    const token = (await supabase.auth.getSession()).data.session?.access_token
    if (!token) throw new Error("ログイン状態を確認してください")
    const res = await fetch(path, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) throw new Error(json?.error ?? "外注先の削除に失敗しました")
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

  const handleDeleteVendor = async (vendor: VendorRow) => {
    if (!orgId) return
    if (!window.confirm(`${vendor.name} を一覧から非表示にしますか？`)) return
    setBusyKey(`delete:${vendor.id}`)
    setError(null)
    setRequestMessage(null)
    try {
      await callAdminApiDelete(`/api/vendors/${vendor.id}?vendorId=${vendor.id}`)
      setRequestMessage(`${vendor.name} を一覧から非表示にしました。`)
      await load()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "外注先の削除に失敗しました")
    } finally {
      setBusyKey(null)
    }
  }

  const handleRequestInvoice = async (vendorId: string) => {
    setBusyKey(`request:${vendorId}`)
    setError(null)
    setRequestMessage(null)
    try {
      await callAdminApi("/api/vendors/request-invoice", { vendorId, month })
      setRequestMessage("外注請求依頼を記録しました。提出状況は下の台帳から追えます。")
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
    setRequestMessage(null)
    setBatchSummary(null)
    try {
      const json = await callAdminApi("/api/vendors/generate-monthly", { month, mode })
      setBatchSummary((json?.summary ?? null) as BatchSummary | null)
      if (mode === "request") {
        setRequestMessage("対象月の外注請求依頼を一括で準備しました。")
      }
      await load()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "月次処理に失敗しました")
    } finally {
      setBusyKey(null)
    }
  }

  const handleManualVendorReminder = async (invoiceId: string) => {
    setBusyKey(`reminder:${invoiceId}`)
    setError(null)
    setRequestMessage(null)
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token
      if (!token) throw new Error("ログイン状態を確認してください")
      const res = await fetch("/api/invoice-requests/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          orgId,
          scope: "vendor_invoices",
          manual: true,
          vendorInvoiceIds: [invoiceId],
        }),
      })
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; summary?: { createdLogs?: number } } | null
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "リマインド記録に失敗しました")
      setRequestMessage(
        (json.summary?.createdLogs ?? 0) > 0 ? "外注請求依頼のフォロー履歴を記録しました。" : "今日のフォロー履歴は既に記録済みです。"
      )
      await load()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "リマインド記録に失敗しました")
    } finally {
      setBusyKey(null)
    }
  }

  if (authLoading || loading) return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  if (!canAccess) return <div style={{ padding: 32, color: "var(--muted)" }}>owner / executive_assistant のみ利用できます。</div>

  return (
    <div style={{ padding: "32px 40px 60px", minHeight: "100vh", background: "var(--bg-grad)" }}>
      <div style={{ maxWidth: 1220, margin: "0 auto", display: "grid", gap: 16 }}>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <ChecklistReturnButton />
          <nav className="page-tab-bar">
            <Link href="/vendors" data-active="true">
              外注管理
            </Link>
            <Link href="/payouts" data-active="false">
              振込
            </Link>
          </nav>
        </div>
        <header style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "end" }}>
          <div>
            <p style={{ fontSize: 12, letterSpacing: "0.08em", color: "var(--muted)", margin: 0 }}>VENDORS</p>
            <h1 style={{ fontSize: 28, margin: "6px 0 8px", color: "var(--text)" }}>外注先一覧</h1>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>
              招待、請求依頼、承認前の状態確認、Payouts への接続までをここから進めます。
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/vendors/submissions" style={{ ...secondaryButtonStyle, textDecoration: "none" }}>
              提出一覧
            </Link>
            <Link href="/payouts" style={{ ...secondaryButtonStyle, textDecoration: "none" }}>
              Payouts を開く
            </Link>
            <Link href="/help/vendors-payouts" style={{ ...secondaryButtonStyle, textDecoration: "none" }}>
              使い方を見る
            </Link>
          </div>
        </header>

        {error ? <section style={{ ...cardStyle, borderColor: "#fecaca", background: "#fff1f2", color: "#b91c1c" }}>{error}</section> : null}
        {requestMessage ? <section style={{ ...cardStyle, borderColor: "#bbf7d0", background: "#f0fdf4", color: "#166534" }}>{requestMessage}</section> : null}

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          <SummaryCard label="外注先数" value={String(vendors.length)} />
          <SummaryCard label="招待送信済み" value={String(vendorMetrics.invited)} />
          <SummaryCard label="依頼送信済み" value={String(vendorMetrics.requested)} />
          <SummaryCard label="対応待ち" value={String(vendorMetrics.actionNeeded)} />
          <SummaryCard label="口座未登録" value={String(vendorMetrics.bankMissing)} />
        </section>

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
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "end", flexWrap: "wrap", marginBottom: 14 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>外注先一覧</h2>
              <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)" }}>
                招待状況と当月請求の進み具合を一覧で確認し、そのまま依頼や詳細確認へ進めます。
              </p>
            </div>
            <input
              value={vendorSearch}
              onChange={(event) => setVendorSearch(event.target.value)}
              placeholder="外注先名 / メール / メモで検索"
              style={{ ...inputStyle, maxWidth: 360 }}
            />
          </div>
          {vendors.length === 0 ? (
            <GuideEmptyState
              title="外注先はまだありません"
              description="先に外注先を登録すると、ポータル招待、請求依頼、支払処理まで同じ導線で進められます。"
              primaryHref="/help/vendors-payouts"
              primaryLabel="運用フローを見る"
              helpHref="/payouts"
              helpLabel="Payouts を開く"
            />
          ) : vendorTableRows.length === 0 ? (
            <div style={{ padding: "12px 0", color: "var(--muted)", fontSize: 13 }}>条件に合う外注先はありません。</div>
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
                  {vendorTableRows.map((vendor) => {
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
                            <button type="button" onClick={() => setSubmitLinkVendor({ id: vendor.id, name: vendor.name })} style={secondaryButtonStyle}>
                              提出URL
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteVendor(vendor)}
                              disabled={busyKey === `delete:${vendor.id}`}
                              style={dangerButtonStyle}
                            >
                              非表示
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

        <section style={{ ...cardStyle, display: "grid", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>請求依頼台帳</h2>
              <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)" }}>
                当月の外注請求依頼を、期限・フォロー履歴・口座準備の観点でまとめて確認します。
              </p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(180px, 1fr))", gap: 10 }}>
              <select value={ledgerStatusFilter} onChange={(event) => setLedgerStatusFilter(event.target.value as VendorLedgerStatusFilter)} style={inputStyle}>
                <option value="all">すべての状態</option>
                <option value="no_request">依頼未作成</option>
                <option value="draft">下書き / 未提出</option>
                <option value="submitted">提出済み</option>
                <option value="approved">承認済み</option>
                <option value="rejected">差し戻し</option>
                <option value="paid">支払済み</option>
              </select>
              <select value={ledgerDeadlineFilter} onChange={(event) => setLedgerDeadlineFilter(event.target.value as VendorLedgerDeadlineFilter)} style={inputStyle}>
                <option value="all">すべての期限状態</option>
                <option value="overdue">期限超過</option>
                <option value="soon">期限が近い</option>
                <option value="scheduled">進行中</option>
                <option value="unset">期限未設定</option>
              </select>
            </div>
          </div>

          {vendorLedgerRows.length === 0 ? (
            <div style={{ color: "var(--muted)", fontSize: 13 }}>条件に合う請求依頼はありません。</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
                <thead>
                  <tr>
                    {["外注先", "期限", "依頼状況", "フォロー履歴", "口座状態", "操作"].map((label) => (
                      <th key={label} style={thStyle}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {vendorLedgerRows.map(({ vendor, invoice, bankReady, deadlineState, latestReminder }) => (
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
                        <div style={{ display: "grid", gap: 6 }}>
                          <span>{fmtDate(invoice?.submit_deadline)}</span>
                          <span style={{ display: "inline-flex", width: "fit-content", padding: "4px 8px", borderRadius: 999, background: deadlineState.bg, color: deadlineState.color, fontSize: 12, fontWeight: 700 }}>
                            {deadlineState.label}
                          </span>
                        </div>
                      </td>
                      <td style={tdStyle}>
                        <div style={{ display: "grid", gap: 4 }}>
                          <span>{invoiceStateLabel(invoice?.status)}</span>
                          <span style={{ color: "var(--muted)", fontSize: 12 }}>
                            {invoice?.request_sent_at ? `依頼送信: ${fmtDate(invoice.request_sent_at)}` : "依頼未送信"}
                          </span>
                          <span style={{ color: "var(--muted)", fontSize: 12 }}>
                            {invoice ? `請求額: ${formatYen(invoice.total)}` : "当月請求は未作成"}
                          </span>
                          {invoice?.rejected_reason ? <span style={{ color: "#b45309", fontSize: 12 }}>差し戻し理由: {invoice.rejected_reason}</span> : null}
                        </div>
                      </td>
                      <td style={tdStyle}>
                        <div style={{ display: "grid", gap: 4 }}>
                          <span style={{ fontSize: 12, color: "var(--muted)" }}>
                            最新: {latestReminder ? `${fmtDate(latestReminder.created_at)} / ${latestReminder.reminder_type}` : "履歴なし"}
                          </span>
                          <span style={{ fontSize: 12, color: "var(--muted)" }}>
                            累計: {invoice?.reminder_logs?.length ?? 0} 件
                          </span>
                        </div>
                      </td>
                      <td style={tdStyle}>
                        <span style={{ display: "inline-flex", padding: "4px 8px", borderRadius: 999, background: bankReady ? "#dcfce7" : "#fee2e2", color: bankReady ? "#166534" : "#b91c1c", fontSize: 12, fontWeight: 700 }}>
                          {bankReady ? "既定口座あり" : "口座未登録"}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button
                            type="button"
                            onClick={() => (invoice ? void handleManualVendorReminder(invoice.id) : void handleRequestInvoice(vendor.id))}
                            disabled={busyKey === `reminder:${invoice?.id ?? ""}` || busyKey === `request:${vendor.id}`}
                            style={secondaryButtonStyle}
                          >
                            {invoice ? "フォロー記録" : "請求依頼"}
                          </button>
                          <Link href={invoice ? `/vendors/${vendor.id}/invoices/${invoice.id}` : `/vendors/${vendor.id}`} style={{ ...secondaryButtonStyle, textDecoration: "none" }}>
                            詳細
                          </Link>
                          {(invoice?.status === "approved" || invoice?.status === "paid") && (
                            <Link href="/payouts" style={{ ...secondaryButtonStyle, textDecoration: "none" }}>
                              Payouts
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      {submitLinkVendor && orgId ? (
        <VendorSubmitLinkDialog
          orgId={orgId}
          vendorId={submitLinkVendor.id}
          vendorName={submitLinkVendor.name}
          onClose={() => setSubmitLinkVendor(null)}
        />
      ) : null}
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
