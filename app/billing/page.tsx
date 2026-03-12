"use client"

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react"
import Link from "next/link"
import GuideEmptyState from "@/components/shared/GuideEmptyState"
import { useAuthOrg } from "@/hooks/useAuthOrg"
import type { BillingDuplicateMode, BillingPreviewResult } from "@/lib/monthlyBilling"
import { supabase } from "@/lib/supabase"

const cardStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 16,
  background: "var(--surface)",
  boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
}

const inputStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--input-border)",
  background: "var(--input-bg)",
  color: "var(--input-text)",
}

type ClientOption = {
  id: string
  name: string
}

type MonthInvoice = {
  id: string
  client_id: string | null
  invoice_no: string | null
  invoice_title: string | null
  status: string
  total: number | null
}

type GenerateResponse = {
  ok?: boolean
  billing_month?: string
  generated?: Array<{
    client_id: string
    client_name: string
    invoice_id: string
    invoice_no: string
    content_count: number
  }>
  skipped?: Array<{
    client_id: string
    client_name: string
    reason: string
  }>
  message?: string
}

type InvoiceRequestLog = {
  id: string
  reminder_type: string
  recipient_label: string | null
  recipient_email: string | null
  message: string | null
  created_at: string
}

type InvoiceRequestRow = {
  id: string
  client_id: string | null
  guest_name: string | null
  guest_company_name: string | null
  recipient_email: string | null
  requested_title: string | null
  requested_description: string | null
  due_date: string | null
  request_deadline: string | null
  status: string
  request_type: string | null
  reminder_enabled: boolean | null
  reminder_lead_days: number | null
  reminder_count: number | null
  reminder_message: string | null
  last_reminded_at: string | null
  last_sent_at: string | null
  issued_invoice_id: string | null
  created_at: string
  reminder_logs?: InvoiceRequestLog[]
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(Number(value || 0))

const thisMonth = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}

function fmtDate(value?: string | null) {
  return value ? value.slice(0, 10) : "-"
}

function requestDeadlineState(deadline?: string | null) {
  if (!deadline) return { label: "期限未設定", color: "var(--muted)", bg: "rgba(148,163,184,0.14)" }
  const today = new Date()
  const base = new Date(`${deadline}T00:00:00`)
  const diff = Math.round((base.getTime() - new Date(today.toISOString().slice(0, 10)).getTime()) / 86400000)
  if (diff < 0) return { label: "期限超過", color: "#b91c1c", bg: "#fee2e2" }
  if (diff <= 3) return { label: "期限が近い", color: "#b45309", bg: "#fef3c7" }
  return { label: "進行中", color: "#166534", bg: "#dcfce7" }
}

async function getAccessToken() {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

export default function BillingPage() {
  const { activeOrgId: orgId, role, loading: authLoading } = useAuthOrg({ redirectToOnboarding: true })
  const canAccess = role === "owner" || role === "executive_assistant"

  const [loading, setLoading] = useState(true)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [monthInvoiceLoading, setMonthInvoiceLoading] = useState(false)
  const [requestLoading, setRequestLoading] = useState(false)
  const [billingMonth, setBillingMonth] = useState(thisMonth())
  const [monthOptions, setMonthOptions] = useState<string[]>([])
  const [clients, setClients] = useState<ClientOption[]>([])
  const [clientFilter, setClientFilter] = useState("")
  const [duplicateMode, setDuplicateMode] = useState<BillingDuplicateMode>("skip_existing")
  const [preview, setPreview] = useState<BillingPreviewResult | null>(null)
  const [monthInvoices, setMonthInvoices] = useState<MonthInvoice[]>([])
  const [invoiceRequests, setInvoiceRequests] = useState<InvoiceRequestRow[]>([])
  const [generating, setGenerating] = useState(false)
  const [generatingClientId, setGeneratingClientId] = useState<string | null>(null)
  const [zipLoading, setZipLoading] = useState(false)
  const [requestBusyId, setRequestBusyId] = useState<string | null>(null)
  const [creatingRequest, setCreatingRequest] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [requestMessage, setRequestMessage] = useState<string | null>(null)
  const [result, setResult] = useState<GenerateResponse | null>(null)

  const [requestClientId, setRequestClientId] = useState("")
  const [requestGuestName, setRequestGuestName] = useState("")
  const [requestGuestCompanyName, setRequestGuestCompanyName] = useState("")
  const [requestEmail, setRequestEmail] = useState("")
  const [requestTitle, setRequestTitle] = useState("請求書のご提出依頼")
  const [requestDescription, setRequestDescription] = useState("")
  const [requestDeadline, setRequestDeadline] = useState(new Date().toISOString().slice(0, 10))
  const [requestReminderEnabled, setRequestReminderEnabled] = useState(true)
  const [requestLeadDays, setRequestLeadDays] = useState(3)

  useEffect(() => {
    if (!orgId || !canAccess) {
      setLoading(false)
      return
    }
    let active = true

    const loadBase = async () => {
      setLoading(true)
      const [clientsRes, monthsRes] = await Promise.all([
        supabase.from("clients").select("id, name").eq("org_id", orgId).order("name"),
        supabase.from("contents").select("delivery_month").eq("org_id", orgId).not("delivery_month", "is", null),
      ])

      if (!active) return

      if (clientsRes.error) {
        setError(`取引先一覧の読み込みに失敗しました: ${clientsRes.error.message}`)
      } else {
        setClients((clientsRes.data ?? []) as ClientOption[])
      }

      if (monthsRes.error) {
        setMonthOptions([billingMonth])
      } else {
        const months = Array.from(
          new Set(
            ((monthsRes.data ?? []) as Array<{ delivery_month: string }>)
              .map((row) => row.delivery_month)
              .filter(Boolean)
          )
        )
          .sort()
          .reverse()
        if (!months.includes(thisMonth())) months.unshift(thisMonth())
        if (!months.includes(billingMonth)) months.unshift(billingMonth)
        setMonthOptions(Array.from(new Set(months)))
      }

      setLoading(false)
    }

    void loadBase()
    return () => {
      active = false
    }
  }, [billingMonth, canAccess, orgId])

  const loadPreview = useCallback(async () => {
    if (!orgId || !canAccess) return
    setPreviewLoading(true)
    setError(null)
    try {
      const token = await getAccessToken()
      if (!token) {
        setError("ログイン状態を確認してください")
        return
      }
      const res = await fetch("/api/billing/preview", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          billing_month: billingMonth,
          client_id: clientFilter || null,
        }),
      })
      const json = (await res.json().catch(() => null)) as { ok?: boolean; preview?: BillingPreviewResult; message?: string } | null
      if (!res.ok || !json?.ok || !json.preview) {
        setError(json?.message ?? "月次請求プレビューの取得に失敗しました")
        setPreview(null)
        return
      }
      setPreview(json.preview)
    } finally {
      setPreviewLoading(false)
    }
  }, [billingMonth, canAccess, clientFilter, orgId])

  const loadMonthInvoices = useCallback(async () => {
    if (!orgId || !canAccess) return
    setMonthInvoiceLoading(true)
    try {
      const { data, error: invoiceError } = await supabase
        .from("invoices")
        .select("id, client_id, invoice_no, invoice_title, status, total")
        .eq("org_id", orgId)
        .eq("invoice_month", billingMonth)
        .order("created_at", { ascending: false })
      if (invoiceError) {
        setError(`当月の請求書一覧の取得に失敗しました: ${invoiceError.message}`)
        setMonthInvoices([])
      } else {
        setMonthInvoices((data ?? []) as MonthInvoice[])
      }
    } finally {
      setMonthInvoiceLoading(false)
    }
  }, [billingMonth, canAccess, orgId])

  const loadInvoiceRequests = useCallback(async () => {
    if (!orgId || !canAccess) return
    setRequestLoading(true)
    try {
      const token = await getAccessToken()
      if (!token) {
        setError("ログイン状態を確認してください")
        return
      }
      const res = await fetch("/api/invoice-requests?limit=50", {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; requests?: InvoiceRequestRow[] } | null
      if (!res.ok || !json?.ok) {
        setError(json?.message ?? "請求依頼一覧の取得に失敗しました")
        setInvoiceRequests([])
        return
      }
      setInvoiceRequests(json.requests ?? [])
    } finally {
      setRequestLoading(false)
    }
  }, [canAccess, orgId])

  useEffect(() => {
    if (!orgId || !canAccess) return
    void Promise.all([loadPreview(), loadMonthInvoices(), loadInvoiceRequests()])
  }, [canAccess, loadInvoiceRequests, loadMonthInvoices, loadPreview, orgId])

  useEffect(() => {
    if (!requestClientId) return
    const client = clients.find((row) => row.id === requestClientId)
    if (!client) return
    setRequestGuestName(client.name)
    setRequestGuestCompanyName(client.name)
  }, [clients, requestClientId])

  const generateInvoices = async (clientIds?: string[]) => {
    if (!canAccess) return
    const warningTargets =
      preview?.clients.filter((client) =>
        (clientIds ? clientIds.includes(client.client_id) : true) && client.existing_invoice_count > 0
      ) ?? []

    if (warningTargets.length > 0 && duplicateMode === "allow_additional") {
      const ok = window.confirm(
        `既存請求書がある取引先を ${warningTargets.length} 件含みます。追加請求書として新規発行しますか。`
      )
      if (!ok) return
    }

    setGenerating(true)
    setGeneratingClientId(clientIds?.[0] ?? null)
    setError(null)
    setSuccess(null)
    setResult(null)

    try {
      const token = await getAccessToken()
      if (!token) {
        setError("ログイン状態を確認してください")
        return
      }

      const res = await fetch("/api/billing/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          billing_month: billingMonth,
          client_ids: clientIds,
          duplicate_mode: duplicateMode,
        }),
      })
      const json = (await res.json().catch(() => null)) as GenerateResponse | null
      if (!res.ok || !json?.ok) {
        setError(json?.message ?? "月次請求の作成に失敗しました")
        return
      }

      const generated = Array.isArray(json.generated) ? json.generated : []
      if (generated.length > 0) {
        for (const row of generated) {
          await fetch(`/api/invoices/${row.invoice_id}/pdf`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          }).catch(() => null)
        }
      }

      setResult(json)
      setSuccess(
        generated.length > 0
          ? `${generated.length} 件の請求書を作成しました。PDF もあわせて生成しています。`
          : "新しく作成された請求書はありませんでした。"
      )
      await Promise.all([loadPreview(), loadMonthInvoices()])
    } finally {
      setGenerating(false)
      setGeneratingClientId(null)
    }
  }

  const downloadMonthZip = async () => {
    if (monthInvoices.length === 0) return
    setZipLoading(true)
    setError(null)
    try {
      const token = await getAccessToken()
      if (!token) {
        setError("ログイン状態を確認してください")
        return
      }
      const ids = monthInvoices.map((row) => row.id)
      const res = await fetch("/api/invoices/bulk-zip", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ invoiceIds: ids }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null
        setError(json?.error ?? "請求書 ZIP の作成に失敗しました")
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `請求書_${billingMonth}.zip`
      link.click()
      URL.revokeObjectURL(url)
    } finally {
      setZipLoading(false)
    }
  }

  const handleCreateRequest = async () => {
    if (!requestClientId && !requestGuestName.trim()) {
      setError("請求依頼の宛先を指定してください")
      return
    }
    setCreatingRequest(true)
    setError(null)
    setRequestMessage(null)
    try {
      const token = await getAccessToken()
      if (!token) {
        setError("ログイン状態を確認してください")
        return
      }
      const res = await fetch("/api/invoice-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          requests: [
            {
              client_id: requestClientId || null,
              guest_name: requestClientId ? null : requestGuestName,
              guest_company_name: requestClientId ? null : requestGuestCompanyName,
              recipient_email: requestEmail,
              requested_title: requestTitle,
              requested_description: requestDescription,
              due_date: requestDeadline,
              request_deadline: requestDeadline,
              reminder_enabled: requestReminderEnabled,
              reminder_lead_days: requestLeadDays,
            },
          ],
        }),
      })
      const json = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; count?: number } | null
      if (!res.ok || !json?.ok) {
        setError(json?.message ?? "請求依頼の作成に失敗しました")
        return
      }
      setRequestMessage(`${json.count ?? 1} 件の請求依頼を登録しました。`)
      setRequestClientId("")
      setRequestGuestName("")
      setRequestGuestCompanyName("")
      setRequestEmail("")
      setRequestDescription("")
      setRequestReminderEnabled(true)
      setRequestLeadDays(3)
      await loadInvoiceRequests()
    } finally {
      setCreatingRequest(false)
    }
  }

  const handleManualReminder = async (requestId: string) => {
    setRequestBusyId(requestId)
    setError(null)
    setRequestMessage(null)
    try {
      const token = await getAccessToken()
      if (!token) {
        setError("ログイン状態を確認してください")
        return
      }
      const res = await fetch("/api/invoice-requests/reminders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          orgId,
          scope: "invoice_requests",
          manual: true,
          invoiceRequestIds: [requestId],
        }),
      })
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; summary?: { createdLogs: number } } | null
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? "リマインド記録に失敗しました")
        return
      }
      setRequestMessage(
        (json.summary?.createdLogs ?? 0) > 0 ? "リマインド履歴を記録しました。" : "今回追加で記録するリマインドはありませんでした。"
      )
      await loadInvoiceRequests()
    } finally {
      setRequestBusyId(null)
    }
  }

  const existingClientCount = useMemo(
    () => preview?.clients.filter((row) => row.existing_invoice_count > 0).length ?? 0,
    [preview]
  )
  const generatableClientCount = useMemo(() => {
    if (!preview) return 0
    return preview.clients.filter((row) => duplicateMode === "allow_additional" || row.existing_invoice_count === 0).length
  }, [duplicateMode, preview])
  const overdueCount = useMemo(
    () => invoiceRequests.filter((row) => requestDeadlineState(row.request_deadline).label === "期限超過").length,
    [invoiceRequests]
  )

  if (authLoading || loading) {
    return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  }

  if (!canAccess) {
    return (
      <div style={{ padding: 32 }}>
        <div style={cardStyle}>
          <h1 style={{ marginTop: 0, fontSize: 20 }}>Billing</h1>
          <p style={{ color: "var(--muted)" }}>請求管理は owner / executive_assistant のみ利用できます。</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: "32px 40px 60px", minHeight: "100vh", background: "var(--bg-grad)" }}>
      <div style={{ display: "grid", gap: 16 }}>
        <header style={{ display: "grid", gap: 8 }}>
          <p style={{ fontSize: 12, letterSpacing: "0.08em", color: "var(--muted)", margin: 0 }}>BILLING</p>
          <h1 style={{ fontSize: 28, margin: 0, color: "var(--text)" }}>月次請求と請求依頼</h1>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>
            月次請求の一括発行と、請求依頼の期限フォローを同じ画面で管理します。送付は PDF 生成まで、人の確認フローは維持します。
          </p>
        </header>

        <section style={{ ...cardStyle, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>対象月</span>
            <select value={billingMonth} onChange={(event) => setBillingMonth(event.target.value)} style={inputStyle}>
              {monthOptions.map((month) => (
                <option key={month} value={month}>
                  {month}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>取引先絞り込み</span>
            <select value={clientFilter} onChange={(event) => setClientFilter(event.target.value)} style={{ ...inputStyle, minWidth: 220 }}>
              <option value="">すべて</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>重複請求の扱い</span>
            <select value={duplicateMode} onChange={(event) => setDuplicateMode(event.target.value as BillingDuplicateMode)} style={{ ...inputStyle, minWidth: 220 }}>
              <option value="skip_existing">既存請求があればスキップ</option>
              <option value="allow_additional">追加請求書として発行</option>
            </select>
          </label>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginLeft: "auto", flexWrap: "wrap" }}>
            <button type="button" onClick={() => void loadPreview()} disabled={previewLoading} style={{ ...inputStyle, cursor: "pointer", fontWeight: 700 }}>
              {previewLoading ? "更新中..." : "プレビュー更新"}
            </button>
            <button
              type="button"
              onClick={() => void generateInvoices()}
              disabled={generating || !preview || preview.clients.length === 0}
              style={{ padding: "10px 16px", borderRadius: 10, border: "1px solid var(--button-primary-bg)", background: "var(--button-primary-bg)", color: "var(--primary-contrast)", fontWeight: 700, cursor: generating ? "not-allowed" : "pointer" }}
            >
              {generating && !generatingClientId ? "一括発行中..." : "この月を一括発行"}
            </button>
          </div>
        </section>

        <section style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          <MetricCard label="請求対象件数" value={String(preview?.total_count ?? 0)} />
          <MetricCard label="請求対象金額" value={formatCurrency(preview?.total_amount ?? 0)} />
          <MetricCard label="対象取引先" value={String(preview?.total_clients ?? 0)} />
          <MetricCard label="既存請求あり" value={String(existingClientCount)} accent={existingClientCount > 0 ? "#b45309" : undefined} />
          <MetricCard label="発行可能取引先" value={String(generatableClientCount)} />
          <MetricCard label="当月の発行済み数" value={String(monthInvoices.length)} />
          <MetricCard label="請求依頼件数" value={String(invoiceRequests.length)} />
          <MetricCard label="期限超過" value={String(overdueCount)} accent={overdueCount > 0 ? "#b91c1c" : undefined} />
        </section>

        <section style={{ ...cardStyle, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <Link href={`/invoices?month=${encodeURIComponent(billingMonth)}`} style={{ color: "var(--primary)", fontWeight: 700, textDecoration: "none" }}>
            当月の請求書一覧
          </Link>
          <Link href="/invoices/new" style={{ color: "var(--primary)", fontWeight: 700, textDecoration: "none" }}>
            手動で請求書を作成
          </Link>
          <Link href="/settings/workspace" style={{ color: "var(--primary)", fontWeight: 700, textDecoration: "none" }}>
            請求元情報と銀行設定
          </Link>
          <button type="button" onClick={() => void downloadMonthZip()} disabled={zipLoading || monthInvoices.length === 0} style={{ marginLeft: "auto", ...inputStyle, cursor: monthInvoices.length === 0 ? "not-allowed" : "pointer", fontWeight: 700 }}>
            {zipLoading ? "ZIP 作成中..." : "当月の請求書 ZIP"}
          </button>
        </section>

        {error ? <div style={{ ...cardStyle, borderColor: "#fecaca", background: "#fff1f2", color: "#b91c1c" }}>{error}</div> : null}

        {success ? (
          <div style={{ ...cardStyle, borderColor: "#bbf7d0", background: "#f0fdf4", color: "#166534" }}>
            <div>{success}</div>
            {result && (result.generated?.length || result.skipped?.length) ? (
              <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                {(result.generated ?? []).map((row) => (
                  <div key={row.invoice_id} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <strong>{row.client_name}</strong>
                    <span>{row.content_count}件</span>
                    <Link href={`/invoices/${row.invoice_id}`} style={{ color: "var(--primary)", fontWeight: 700 }}>
                      {row.invoice_no}
                    </Link>
                  </div>
                ))}
                {(result.skipped ?? []).map((row) => (
                  <div key={`${row.client_id}-${row.reason}`} style={{ color: "#92400e" }}>
                    {row.client_name}: {row.reason}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <section style={{ ...cardStyle, overflowX: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>月次請求プレビュー</h2>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--muted)" }}>
                `delivery_month` と `billable_flag=true` を対象に、未請求コンテンツを取引先単位で集計しています。
              </p>
            </div>
            {monthInvoiceLoading ? <span style={{ fontSize: 12, color: "var(--muted)" }}>請求書一覧を更新中...</span> : null}
          </div>

          {!previewLoading && (!preview || preview.clients.length === 0) ? (
            <GuideEmptyState
              title="この月に請求対象はありません"
              description="コンテンツの delivery_month と billable_flag を見直すと、この一覧に請求候補が出ます。"
              primaryHref="/contents"
              primaryLabel="コンテンツを確認"
              helpHref="/help/billing"
              helpLabel="請求フローを見る"
            />
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 920 }}>
              <thead>
                <tr>
                  {["取引先", "対象月", "件数", "金額", "既存請求", "発行可否", "注意", "操作"].map((label) => (
                    <th key={label} style={{ textAlign: "left", padding: "10px 12px", borderBottom: "1px solid var(--table-border)", color: "var(--muted)", fontSize: 12, fontWeight: 600 }}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview?.clients.map((client) => {
                  const allowGenerate = duplicateMode === "allow_additional" || client.existing_invoice_count === 0
                  return (
                    <tr key={client.client_id}>
                      <td style={tableCellStrong}>{client.client_name}</td>
                      <td style={tableCell}>{client.billing_month}</td>
                      <td style={tableCell}>{client.target_count}</td>
                      <td style={tableCell}>{formatCurrency(client.total_amount)}</td>
                      <td style={tableCell}>{client.existing_invoice_count > 0 ? `${client.existing_invoice_count}件` : "なし"}</td>
                      <td style={{ ...tableCell, color: allowGenerate ? "#166534" : "#b45309" }}>{allowGenerate ? "発行できます" : "既存請求あり"}</td>
                      <td style={{ ...tableCell, maxWidth: 280 }}>{client.warning ?? "-"}</td>
                      <td style={tableCell}>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button type="button" disabled={generating} onClick={() => void generateInvoices([client.client_id])} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--button-primary-bg)", background: "var(--button-primary-bg)", color: "var(--primary-contrast)", cursor: generating ? "not-allowed" : "pointer" }}>
                            {generating && generatingClientId === client.client_id ? "発行中..." : "この取引先だけ発行"}
                          </button>
                          {client.existing_invoice_count > 0 ? (
                            <Link href={`/invoices?month=${encodeURIComponent(billingMonth)}`} style={secondaryLinkStyle}>
                              既存請求を見る
                            </Link>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </section>

        <section style={{ ...cardStyle, display: "grid", gap: 14 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>請求依頼の登録</h2>
            <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 13 }}>
              取引先登録済みでも、急ぎのゲスト宛先でも登録できます。期限とリマインド条件を先に持たせておくと、後追い運用が崩れません。
            </p>
          </div>

          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span>取引先</span>
              <select value={requestClientId} onChange={(event) => setRequestClientId(event.target.value)} style={inputStyle}>
                <option value="">ゲスト宛先で登録</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </label>
            {!requestClientId ? (
              <>
                <label style={{ display: "grid", gap: 6 }}>
                  <span>宛先名</span>
                  <input value={requestGuestName} onChange={(event) => setRequestGuestName(event.target.value)} style={inputStyle} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span>会社名</span>
                  <input value={requestGuestCompanyName} onChange={(event) => setRequestGuestCompanyName(event.target.value)} style={inputStyle} />
                </label>
              </>
            ) : null}
            <label style={{ display: "grid", gap: 6 }}>
              <span>メールアドレス</span>
              <input value={requestEmail} onChange={(event) => setRequestEmail(event.target.value)} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>依頼タイトル</span>
              <input value={requestTitle} onChange={(event) => setRequestTitle(event.target.value)} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>期限</span>
              <input type="date" value={requestDeadline} onChange={(event) => setRequestDeadline(event.target.value)} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>何日前から要フォロー</span>
              <input type="number" min={0} max={30} value={requestLeadDays} onChange={(event) => setRequestLeadDays(Number(event.target.value || 0))} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6, gridColumn: "1 / -1" }}>
              <span>メモ</span>
              <textarea value={requestDescription} onChange={(event) => setRequestDescription(event.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
            </label>
          </div>

          <label style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--text)" }}>
            <input type="checkbox" checked={requestReminderEnabled} onChange={(event) => setRequestReminderEnabled(event.target.checked)} />
            期限管理に含める
          </label>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" onClick={() => void handleCreateRequest()} disabled={creatingRequest} style={{ padding: "10px 16px", borderRadius: 10, border: "1px solid var(--button-primary-bg)", background: "var(--button-primary-bg)", color: "var(--primary-contrast)", fontWeight: 700, cursor: creatingRequest ? "not-allowed" : "pointer" }}>
              {creatingRequest ? "登録中..." : "請求依頼を登録"}
            </button>
            <span style={{ color: "var(--muted)", fontSize: 12 }}>自動メール送信は行わず、依頼台帳と通知・履歴だけを更新します。</span>
          </div>

          {requestMessage ? <div style={{ borderRadius: 10, padding: 12, background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0" }}>{requestMessage}</div> : null}
        </section>

        <section style={{ ...cardStyle, overflowX: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>請求依頼一覧</h2>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--muted)" }}>
                期限、最終リマインド、請求書化状況までを一列で確認できます。
              </p>
            </div>
            {requestLoading ? <span style={{ fontSize: 12, color: "var(--muted)" }}>請求依頼を更新中...</span> : null}
          </div>

          {invoiceRequests.length === 0 && !requestLoading ? (
            <GuideEmptyState
              title="請求依頼はまだありません"
              description="請求依頼を先に登録しておくと、期限超過やリマインド履歴を Billing でまとめて追えます。"
              primaryHref="/vendors"
              primaryLabel="外注先を見る"
              helpHref="/help/billing"
              helpLabel="請求の流れを見る"
            />
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1080 }}>
              <thead>
                <tr>
                  {["宛先", "依頼内容", "期限", "状態", "リマインド", "履歴", "操作"].map((label) => (
                    <th key={label} style={{ textAlign: "left", padding: "10px 12px", borderBottom: "1px solid var(--table-border)", color: "var(--muted)", fontSize: 12, fontWeight: 600 }}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoiceRequests.map((row) => {
                  const deadlineState = requestDeadlineState(row.request_deadline)
                  const recipient = row.guest_company_name || row.guest_name || "取引先指定"
                  return (
                    <tr key={row.id}>
                      <td style={tableCellStrong}>
                        <div style={{ display: "grid", gap: 4 }}>
                          <span>{recipient}</span>
                          <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 12 }}>{row.recipient_email || "メール未登録"}</span>
                        </div>
                      </td>
                      <td style={tableCell}>
                        <div style={{ display: "grid", gap: 4 }}>
                          <strong>{row.requested_title || "請求依頼"}</strong>
                          <span style={{ color: "var(--muted)", fontSize: 12 }}>{row.requested_description || "-"}</span>
                        </div>
                      </td>
                      <td style={tableCell}>
                        <div style={{ display: "grid", gap: 6 }}>
                          <span>{fmtDate(row.request_deadline || row.due_date)}</span>
                          <span style={{ display: "inline-flex", width: "fit-content", padding: "4px 8px", borderRadius: 999, background: deadlineState.bg, color: deadlineState.color, fontSize: 12, fontWeight: 700 }}>
                            {deadlineState.label}
                          </span>
                        </div>
                      </td>
                      <td style={tableCell}>
                        <div style={{ display: "grid", gap: 4 }}>
                          <span>{row.status}</span>
                          {row.issued_invoice_id ? (
                            <Link href={`/invoices/${row.issued_invoice_id}`} style={{ color: "var(--primary)", fontSize: 12, fontWeight: 700 }}>
                              請求書を見る
                            </Link>
                          ) : null}
                        </div>
                      </td>
                      <td style={tableCell}>
                        <div style={{ display: "grid", gap: 4 }}>
                          <span>{row.reminder_enabled ? `ON / ${row.reminder_lead_days ?? 3}日前` : "OFF"}</span>
                          <span style={{ color: "var(--muted)", fontSize: 12 }}>
                            最終: {row.last_reminded_at ? fmtDate(row.last_reminded_at) : "-"} / 累計 {row.reminder_count ?? 0} 回
                          </span>
                        </div>
                      </td>
                      <td style={tableCell}>
                        <div style={{ display: "grid", gap: 6 }}>
                          {(row.reminder_logs ?? []).slice(0, 2).map((log) => (
                            <div key={log.id} style={{ fontSize: 12 }}>
                              <strong>{fmtDate(log.created_at)}</strong>
                              <span style={{ color: "var(--muted)" }}> {log.reminder_type}</span>
                            </div>
                          ))}
                          {(row.reminder_logs ?? []).length === 0 ? <span style={{ color: "var(--muted)", fontSize: 12 }}>履歴なし</span> : null}
                        </div>
                      </td>
                      <td style={tableCell}>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button type="button" onClick={() => void handleManualReminder(row.id)} disabled={requestBusyId === row.id} style={{ ...secondaryActionStyle, cursor: requestBusyId === row.id ? "not-allowed" : "pointer" }}>
                            {requestBusyId === row.id ? "記録中..." : "リマインド記録"}
                          </button>
                          {!row.issued_invoice_id ? (
                            <Link href={`/invoices/new?requestId=${encodeURIComponent(row.id)}`} style={secondaryLinkStyle}>
                              請求書を作成
                            </Link>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  )
}

function MetricCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: accent ?? "var(--text)" }}>{value}</div>
    </div>
  )
}

const tableCell: CSSProperties = {
  padding: "12px",
  borderBottom: "1px solid var(--table-border)",
  color: "var(--text)",
  verticalAlign: "top",
}

const tableCellStrong: CSSProperties = {
  ...tableCell,
  fontWeight: 700,
}

const secondaryLinkStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--surface-2)",
  color: "var(--text)",
  textDecoration: "none",
  fontWeight: 700,
}

const secondaryActionStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
  fontWeight: 700,
}
