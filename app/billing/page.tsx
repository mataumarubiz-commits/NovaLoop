"use client"

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react"
import Link from "next/link"
import ChecklistReturnButton from "@/components/home/ChecklistReturnButton"
import GuideEmptyState from "@/components/shared/GuideEmptyState"
import type { ApplyAiResultDetail } from "@/lib/aiClientEvents"
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
    invoice_no: string | null
    status?: "draft"
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
  client_name?: string | null
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
  issued_invoice_status?: string | null
  created_at: string
  reminder_logs?: InvoiceRequestLog[]
}

type RequestProgressFilter = "all" | "open" | "issued"
type RequestDeadlineFilter = "all" | "overdue" | "soon" | "scheduled" | "unset"

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

function requestProgressLabel(row: InvoiceRequestRow) {
  if (row.issued_invoice_id) {
    if (row.issued_invoice_status === "draft") return "下書き作成済み"
    if (row.issued_invoice_status === "issued") return "発行済み"
    if (row.issued_invoice_status === "void") return "請求書無効"
    return "請求書作成済み"
  }
  if (row.status === "viewed") return "確認済み"
  if (row.status === "sent") return "送付済み"
  return row.status || "-"
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
  const [requestSearch, setRequestSearch] = useState("")
  const [requestProgressFilter, setRequestProgressFilter] = useState<RequestProgressFilter>("all")
  const [requestDeadlineFilter, setRequestDeadlineFilter] = useState<RequestDeadlineFilter>("all")

  const [requestClientId, setRequestClientId] = useState("")
  const [requestGuestName, setRequestGuestName] = useState("")
  const [requestGuestCompanyName, setRequestGuestCompanyName] = useState("")
  const [requestEmail, setRequestEmail] = useState("")
  const [requestTitle, setRequestTitle] = useState("請求書のご提出依頼")
  const [requestDescription, setRequestDescription] = useState("")
  const [requestReminderMessage, setRequestReminderMessage] = useState("")
  const [requestDeadline, setRequestDeadline] = useState(new Date().toISOString().slice(0, 10))
  const [requestReminderEnabled, setRequestReminderEnabled] = useState(true)
  const [requestLeadDays, setRequestLeadDays] = useState(3)

  const selectedRequestClient = useMemo(() => clients.find((client) => client.id === requestClientId) ?? null, [clients, requestClientId])
  const monthIssuedInvoices = useMemo(
    () => monthInvoices.filter((row) => row.status === "issued"),
    [monthInvoices]
  )

  const buildRequestAiContext = useCallback(() => {
    return [
      `対象月: ${billingMonth}`,
      `送付先クライアント: ${selectedRequestClient?.name ?? "-"}`,
      `送付先担当者: ${requestGuestName || "-"}`,
      `送付先会社名: ${requestGuestCompanyName || "-"}`,
      `送付先メール: ${requestEmail || "-"}`,
      `期限: ${requestDeadline || "-"}`,
      `リマインド: ${requestReminderEnabled ? `ON / ${requestLeadDays}日前` : "OFF"}`,
      preview ? `対象件数: ${preview.total_count} / 合計金額: ${formatCurrency(preview.total_amount)}` : "対象件数: 未取得",
      `請求依頼本文: ${requestDescription || "-"}`,
      `送付添え文: ${requestReminderMessage || "-"}`,
    ].join("\n")
  }, [
    billingMonth,
    preview,
    requestDeadline,
    requestDescription,
    requestEmail,
    requestGuestCompanyName,
    requestGuestName,
    requestLeadDays,
    requestReminderEnabled,
    requestReminderMessage,
    selectedRequestClient,
  ])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ApplyAiResultDetail>).detail
      if (detail?.source !== "billing" || !detail.result?.text) return
      if (detail.applyTarget === "billing_request_title") setRequestTitle(detail.result.text)
      if (detail.applyTarget === "billing_request_description") setRequestDescription(detail.result.text)
      if (detail.applyTarget === "billing_request_reminder_message") setRequestReminderMessage(detail.result.text)
    }

    window.addEventListener("apply-ai-result", handler as EventListener)
    return () => window.removeEventListener("apply-ai-result", handler as EventListener)
  }, [])

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
        `既存請求書がある取引先を ${warningTargets.length} 件含みます。追加の請求書下書きを作成しますか。`
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
      setResult(json)
      setSuccess(
        generated.length > 0
          ? `${generated.length} 件の請求書下書きを作成しました。請求書画面から発行を確定できます。`
          : "新しく作成された請求書はありませんでした。"
      )
      await Promise.all([loadPreview(), loadMonthInvoices()])
    } finally {
      setGenerating(false)
      setGeneratingClientId(null)
    }
  }

  const downloadMonthZip = async () => {
    if (monthIssuedInvoices.length === 0) {
      setError("PDF ZIP は発行済みの請求書がある月だけ作成できます。")
      return
    }
    setZipLoading(true)
    setError(null)
    try {
      const token = await getAccessToken()
      if (!token) {
        setError("ログイン状態を確認してください")
        return
      }
      const ids = monthIssuedInvoices.map((row) => row.id)
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
              reminder_message: requestReminderMessage,
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
      setRequestReminderMessage("")
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
  const filteredInvoiceRequests = useMemo(() => {
    const query = requestSearch.trim().toLowerCase()
    return invoiceRequests.filter((row) => {
      const deadlineState = requestDeadlineState(row.request_deadline)
      const deadlineKey =
        deadlineState.label === "期限超過"
          ? "overdue"
          : deadlineState.label === "期限が近い"
            ? "soon"
            : deadlineState.label === "期限未設定"
              ? "unset"
              : "scheduled"
      const haystack = [
        row.client_name,
        row.guest_company_name,
        row.guest_name,
        row.recipient_email,
        row.requested_title,
        row.requested_description,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      const matchesQuery = !query || haystack.includes(query)
      const matchesProgress =
        requestProgressFilter === "all" ||
        (requestProgressFilter === "issued" ? Boolean(row.issued_invoice_id) : !row.issued_invoice_id)
      const matchesDeadline = requestDeadlineFilter === "all" || requestDeadlineFilter === deadlineKey
      return matchesQuery && matchesProgress && matchesDeadline
    })
  }, [invoiceRequests, requestDeadlineFilter, requestProgressFilter, requestSearch])
  const previewClients = preview?.clients ?? []
  const monthInvoiceTotal = useMemo(
    () => monthInvoices.reduce((sum, row) => sum + Number(row.total ?? 0), 0),
    [monthInvoices]
  )
  const openRequestCount = useMemo(
    () => invoiceRequests.filter((row) => !row.issued_invoice_id).length,
    [invoiceRequests]
  )
  const clientNameMap = useMemo(
    () => new Map(clients.map((client) => [client.id, client.name])),
    [clients]
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
    <div style={{ padding: "32px 24px 72px", minHeight: "100vh", background: "var(--bg-grad)" }}>
      <div style={{ display: "grid", gap: 20, maxWidth: 1380, margin: "0 auto" }}>
        <div>
          <ChecklistReturnButton />
        </div>

        <section style={heroCardStyle}>
          <div
            style={{
              display: "grid",
              gap: 20,
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              alignItems: "start",
            }}
          >
            <div style={{ display: "grid", gap: 16 }}>
              <div style={{ display: "grid", gap: 10 }}>
                <p style={{ margin: 0, fontSize: 12, letterSpacing: "0.12em", color: "var(--muted)" }}>
                  BILLING
                </p>
                <h1 style={{ margin: 0, fontSize: 34, lineHeight: 1.15, color: "var(--text)" }}>
                  請求をまとめて進める
                </h1>
                <p style={{ margin: 0, color: "var(--muted)", fontSize: 15, lineHeight: 1.7 }}>
                  対象月を選んで候補を確認し、必要な取引先だけ請求書下書きを作成します。発行確定まではこの画面で進め、PDF 生成と送付判断は発行後に人が確認します。
                </p>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {["1. 候補を見る", "2. 下書きを作る", "3. 発行後に PDF"].map((step) => (
                  <span key={step} style={heroStepStyle}>
                    {step}
                  </span>
                ))}
              </div>

              <div
                style={{
                  display: "grid",
                  gap: 12,
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                }}
              >
                <MetricCard label="請求対象金額" value={formatCurrency(preview?.total_amount ?? 0)} />
                <MetricCard label="作成できる取引先" value={`${generatableClientCount}社`} />
                <MetricCard label="当月の請求書" value={`${monthInvoices.length}件`} />
                <MetricCard
                  label="期限超過の依頼"
                  value={`${overdueCount}件`}
                  accent={overdueCount > 0 ? "#b91c1c" : undefined}
                />
              </div>
            </div>

            <div style={controlPanelStyle}>
              <SectionHeading
                eyebrow="CONTROL"
                title="対象月と作成条件"
                description="候補を更新してから、一括作成か取引先単位の作成を選びます。"
              />

              <div
                style={{
                  display: "grid",
                  gap: 12,
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                }}
              >
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={fieldLabelStyle}>対象月</span>
                  <select
                    value={billingMonth}
                    onChange={(event) => setBillingMonth(event.target.value)}
                    style={inputStyle}
                  >
                    {monthOptions.map((month) => (
                      <option key={month} value={month}>
                        {month}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={fieldLabelStyle}>表示する取引先</span>
                  <select
                    value={clientFilter}
                    onChange={(event) => setClientFilter(event.target.value)}
                    style={inputStyle}
                  >
                    <option value="">すべて</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={fieldLabelStyle}>既存請求書がある場合</span>
                  <select
                    value={duplicateMode}
                    onChange={(event) =>
                      setDuplicateMode(event.target.value as BillingDuplicateMode)
                    }
                    style={inputStyle}
                  >
                    <option value="skip_existing">スキップする</option>
                    <option value="allow_additional">追加の下書きを作成</option>
                  </select>
                </label>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => void loadPreview()}
                  disabled={previewLoading}
                  style={{
                    ...outlineButtonStyle,
                    cursor: previewLoading ? "not-allowed" : "pointer",
                  }}
                >
                  {previewLoading ? "候補を更新中..." : "請求候補を更新"}
                </button>
                <button
                  type="button"
                  onClick={() => void generateInvoices()}
                  disabled={generating || previewClients.length === 0}
                  style={{
                    ...primaryButtonStyle,
                    cursor:
                      generating || previewClients.length === 0 ? "not-allowed" : "pointer",
                    opacity: generating || previewClients.length === 0 ? 0.7 : 1,
                  }}
                >
                  {generating && !generatingClientId ? "請求書下書きを作成中..." : "この条件で下書きを作成"}
                </button>
              </div>

              <div style={subtlePanelStyle}>
                <div style={{ display: "grid", gap: 6 }}>
                  <strong style={{ fontSize: 14, color: "var(--text)" }}>今の設定</strong>
                  <span style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
                    {clientFilter
                      ? `${clientNameMap.get(clientFilter) ?? "選択中の取引先"}だけを表示しています。`
                      : "すべての取引先を表示しています。"}{" "}
                    {duplicateMode === "skip_existing"
                      ? "既存の請求書がある取引先は新しい下書きを作らずにスキップします。"
                      : "既存の請求書があっても追加の下書きを作成します。"}
                  </span>
                  <span style={{ fontSize: 13, color: "var(--muted)" }}>
                    今月の請求書合計は {formatCurrency(monthInvoiceTotal)}、未処理の請求依頼は{" "}
                    {openRequestCount} 件です。
                  </span>
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <Link
                    href={`/invoices?month=${encodeURIComponent(billingMonth)}`}
                    style={inlineActionLinkStyle}
                  >
                    今月の請求書一覧
                  </Link>
                  <Link href="/invoices/new" style={inlineActionLinkStyle}>
                    手動で請求書を作成
                  </Link>
                  <Link href="/settings/workspace" style={inlineActionLinkStyle}>
                    振込先と請求元を見直す
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        <details style={advancedDetailsStyle}>
          <summary style={advancedSummaryStyle}>詳細設定と従来ビューを開く</summary>
        <header style={{ display: "grid", gap: 8 }}>
          <p style={{ fontSize: 12, letterSpacing: "0.08em", color: "var(--muted)", margin: 0 }}>BILLING</p>
          <h1 style={{ fontSize: 28, margin: 0, color: "var(--text)" }}>月次請求と請求依頼</h1>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>
            月次請求の下書き作成と、請求依頼の期限フォローを同じ画面で管理します。PDF 生成は発行確定後に行い、送付は人の確認フローを維持します。
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
              <option value="allow_additional">追加の下書きを作成</option>
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
              {generating && !generatingClientId ? "一括作成中..." : "この月の下書きを一括作成"}
            </button>
          </div>
        </section>

        <section style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          <MetricCard label="請求対象件数" value={String(preview?.total_count ?? 0)} />
          <MetricCard label="請求対象金額" value={formatCurrency(preview?.total_amount ?? 0)} />
          <MetricCard label="対象取引先" value={String(preview?.total_clients ?? 0)} />
          <MetricCard label="既存請求あり" value={String(existingClientCount)} accent={existingClientCount > 0 ? "#b45309" : undefined} />
          <MetricCard label="作成可能取引先" value={String(generatableClientCount)} />
          <MetricCard label="当月の請求書数" value={String(monthInvoices.length)} />
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
          <button type="button" onClick={() => void downloadMonthZip()} disabled={zipLoading || monthIssuedInvoices.length === 0} style={{ marginLeft: "auto", ...inputStyle, cursor: monthIssuedInvoices.length === 0 ? "not-allowed" : "pointer", fontWeight: 700 }}>
            {zipLoading ? "ZIP 作成中..." : "発行済み請求書 ZIP"}
          </button>
        </section>
        </details>

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
                      {row.invoice_no || "下書きを開く"}
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

        <section style={{ ...sectionCardStyle, overflowX: "auto" }}>
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
              description="案件明細の delivery_month と billable_flag を見直すと、この一覧に請求候補が出ます。"
              primaryHref="/projects"
              primaryLabel="案件明細を確認"
              helpHref="/help/billing"
              helpLabel="請求フローを見る"
            />
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 920 }}>
              <thead>
                <tr>
                  {["取引先", "対象月", "件数", "金額", "既存請求", "作成可否", "注意", "操作"].map((label) => (
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
                      <td style={{ ...tableCell, color: allowGenerate ? "#166534" : "#b45309" }}>{allowGenerate ? "作成できます" : "既存請求あり"}</td>
                      <td style={{ ...tableCell, maxWidth: 280 }}>{client.warning ?? "-"}</td>
                      <td style={tableCell}>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button type="button" disabled={generating} onClick={() => void generateInvoices([client.client_id])} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--button-primary-bg)", background: "var(--button-primary-bg)", color: "var(--primary-contrast)", cursor: generating ? "not-allowed" : "pointer" }}>
                            {generating && generatingClientId === client.client_id ? "作成中..." : "この取引先だけ作成"}
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

        <section style={{ ...sectionCardStyle, display: "grid", gap: 14 }}>
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
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>AI</span>
                <button
                  type="button"
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent("open-ai-palette", {
                        detail: {
                          source: "billing" as const,
                          mode: "request_title" as const,
                          text: requestTitle,
                          compareText: requestTitle,
                          context: buildRequestAiContext(),
                          title: "Billing AI",
                          applyLabel: "件名に反映",
                          applyTarget: "billing_request_title",
                          applyTransform: "first_line" as const,
                          meta: {
                            sourceObject: "invoice_request_draft",
                            recordId: requestClientId || requestEmail || billingMonth,
                            recordLabel: selectedRequestClient?.name || requestGuestName || billingMonth,
                          },
                        },
                      })
                    )
                  }
                  style={{
                    padding: "4px 8px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--surface-2)",
                    color: "var(--text)",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  AI件名案
                </button>
              </div>
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
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent("open-ai-palette", {
                        detail: {
                          source: "billing" as const,
                          mode: "request_message" as const,
                          text: requestDescription,
                          compareText: requestDescription,
                          context: buildRequestAiContext(),
                          title: "Billing AI",
                          applyLabel: "本文に反映",
                          applyTarget: "billing_request_description", // request body
                          meta: {
                            sourceObject: "invoice_request_draft",
                            recordId: requestClientId || requestEmail || billingMonth,
                            recordLabel: selectedRequestClient?.name || requestGuestName || billingMonth,
                          },
                        },
                      })
                    )
                  }
                  style={{
                    padding: "4px 8px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--surface-2)",
                    color: "var(--text)",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  AI依頼文案
                </button>
                <button
                  type="button"
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent("open-ai-palette", {
                        detail: {
                          source: "billing" as const,
                          mode: "send_message" as const,
                          text: requestReminderMessage,
                          compareText: requestReminderMessage,
                          context: buildRequestAiContext(),
                          title: "Billing AI",
                          applyLabel: "本文に反映",
                          applyTarget: "billing_request_reminder_message",
                          meta: {
                            sourceObject: "invoice_request_draft",
                            recordId: requestClientId || requestEmail || billingMonth,
                            recordLabel: selectedRequestClient?.name || requestGuestName || billingMonth,
                          },
                        },
                      })
                    )
                  }
                  style={{
                    padding: "4px 8px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--surface-2)",
                    color: "var(--text)",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  AI送付文案
                </button>
              </div>
              <textarea value={requestDescription} onChange={(event) => setRequestDescription(event.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
            </label>
            <label style={{ display: "grid", gap: 6, gridColumn: "1 / -1" }}>
              <span>送付添え文 / リマインド文</span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent("open-ai-palette", {
                        detail: {
                          source: "billing" as const,
                          mode: "send_message" as const,
                          text: requestReminderMessage,
                          compareText: requestReminderMessage,
                          context: buildRequestAiContext(),
                          title: "Billing AI",
                          applyLabel: "送付文に反映",
                          applyTarget: "billing_request_reminder_message",
                          meta: {
                            sourceObject: "invoice_request_draft",
                            recordId: requestClientId || requestEmail || billingMonth,
                            recordLabel: selectedRequestClient?.name || requestGuestName || billingMonth,
                          },
                        },
                      })
                    )
                  }
                  style={{
                    padding: "4px 8px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--surface-2)",
                    color: "var(--text)",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  AI送付文生成
                </button>
              </div>
              <textarea value={requestReminderMessage} onChange={(event) => setRequestReminderMessage(event.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
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

        <section style={{ ...sectionCardStyle, overflowX: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>請求依頼一覧</h2>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--muted)" }}>
                期限、最終リマインド、請求書化状況までを一列で確認できます。
              </p>
            </div>
            {requestLoading ? <span style={{ fontSize: 12, color: "var(--muted)" }}>請求依頼を更新中...</span> : null}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1.6fr) repeat(2, minmax(180px, 0.8fr))", gap: 10, marginBottom: 12 }}>
            <input
              value={requestSearch}
              onChange={(event) => setRequestSearch(event.target.value)}
              placeholder="請求先 / client / 件名で検索"
              style={{ ...inputStyle, width: "100%" }}
            />
            <select value={requestProgressFilter} onChange={(event) => setRequestProgressFilter(event.target.value as RequestProgressFilter)} style={{ ...inputStyle, width: "100%" }}>
              <option value="all">すべての進行状態</option>
              <option value="open">未請求書化のみ</option>
              <option value="issued">請求書化済み</option>
            </select>
            <select value={requestDeadlineFilter} onChange={(event) => setRequestDeadlineFilter(event.target.value as RequestDeadlineFilter)} style={{ ...inputStyle, width: "100%" }}>
              <option value="all">すべての期限状態</option>
              <option value="overdue">期限超過</option>
              <option value="soon">期限が近い</option>
              <option value="scheduled">進行中</option>
              <option value="unset">期限未設定</option>
            </select>
          </div>

          {invoiceRequests.length === 0 && !requestLoading ? (
            <GuideEmptyState
              title="請求依頼はまだありません"
              description="請求依頼を先に登録しておくと、期限超過やリマインド履歴を Billing でまとめて追えます。"
              primaryHref="/vendors"
              primaryLabel="外注先を見る"
              helpHref="/help/billing-monthly"
              helpLabel="請求の流れを見る"
            />
          ) : filteredInvoiceRequests.length === 0 ? (
            <div style={{ padding: "18px 4px", color: "var(--muted)", fontSize: 13 }}>
              条件に合う請求依頼はありません。検索語かフィルタを見直してください。
            </div>
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
                {filteredInvoiceRequests.map((row) => {
                  const deadlineState = requestDeadlineState(row.request_deadline)
                  const recipient = row.client_name || row.guest_company_name || row.guest_name || "取引先指定"
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
                          <span style={{ color: "var(--muted)", fontSize: 12, whiteSpace: "pre-wrap" }}>送付メッセージ: {row.reminder_message || "-"}</span>
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
                          <span>{requestProgressLabel(row)}</span>
                          {row.issued_invoice_id ? (
                            <Link href={`/invoices/${row.issued_invoice_id}`} style={{ color: "var(--primary)", fontSize: 12, fontWeight: 700 }}>
                              {row.issued_invoice_status === "draft" ? "下書きを見る" : "請求書を見る"}
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
    <div style={metricCardStyle}>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: accent ?? "var(--text)" }}>{value}</div>
    </div>
  )
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string
  title: string
  description: string
}) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {eyebrow ? (
        <span style={{ fontSize: 11, letterSpacing: "0.08em", color: "var(--muted)" }}>
          {eyebrow}
        </span>
      ) : null}
      <h2 style={{ margin: 0, fontSize: 22, color: "var(--text)" }}>{title}</h2>
      <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.7 }}>
        {description}
      </p>
    </div>
  )
}

const heroCardStyle: CSSProperties = {
  ...cardStyle,
  padding: 24,
  borderRadius: 24,
  background: "linear-gradient(135deg, rgba(255,255,255,0.98), rgba(247,250,252,0.96))",
  boxShadow: "0 20px 45px rgba(15, 23, 42, 0.08)",
}

const heroStepStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "8px 12px",
  borderRadius: 999,
  background: "rgba(15, 23, 42, 0.06)",
  color: "var(--text)",
  fontSize: 13,
  fontWeight: 700,
}

const metricCardStyle: CSSProperties = {
  ...cardStyle,
  padding: 18,
  borderRadius: 18,
  background: "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.94))",
}

const sectionCardStyle: CSSProperties = {
  ...cardStyle,
  padding: 20,
  borderRadius: 20,
}

const controlPanelStyle: CSSProperties = {
  ...cardStyle,
  padding: 20,
  borderRadius: 20,
  display: "grid",
  gap: 16,
  background: "rgba(255,255,255,0.9)",
}

const subtlePanelStyle: CSSProperties = {
  border: "1px solid rgba(15, 23, 42, 0.08)",
  borderRadius: 16,
  padding: 14,
  background: "rgba(255,255,255,0.82)",
}

const primaryButtonStyle: CSSProperties = {
  padding: "12px 16px",
  borderRadius: 12,
  border: "1px solid var(--button-primary-bg)",
  background: "var(--button-primary-bg)",
  color: "var(--primary-contrast)",
  fontWeight: 700,
}

const outlineButtonStyle: CSSProperties = {
  padding: "12px 16px",
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "rgba(255,255,255,0.92)",
  color: "var(--text)",
  fontWeight: 700,
}

const fieldLabelStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--muted)",
}

const inlineActionLinkStyle: CSSProperties = {
  color: "var(--text)",
  fontWeight: 700,
  textDecoration: "none",
}

const advancedDetailsStyle: CSSProperties = {
  ...cardStyle,
  padding: 16,
  borderRadius: 18,
  display: "grid",
  gap: 16,
}

const advancedSummaryStyle: CSSProperties = {
  cursor: "pointer",
  fontWeight: 700,
  color: "var(--text)",
  listStyle: "none",
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
