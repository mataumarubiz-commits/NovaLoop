"use client"

import Link from "next/link"
import { useEffect, useMemo, useState, type CSSProperties } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useAuthOrg } from "@/hooks/useAuthOrg"
import GuideEmptyState from "@/components/shared/GuideEmptyState"
import { resolveInvoiceRecipientLabel } from "@/lib/invoiceNaming"

type InvoiceRow = {
  id: string
  invoice_month: string
  invoice_title: string | null
  invoice_no: string | null
  status: "draft" | "issued" | "void" | string
  issue_date: string
  due_date: string
  subtotal: number
  total: number | null
  created_at: string
  client_id: string | null
  guest_client_name: string | null
  guest_company_name: string | null
  guest_client_email: string | null
  pdf_path: string | null
  send_prepared_at: string | null
}

type ClientRow = {
  id: string
  name: string
  billing_name: string | null
  billing_email: string | null
}

type InvoiceLineRow = {
  id: string
  description: string | null
  quantity: number
  unit_price: number
  amount: number
  sort_order: number
  project_name?: string | null
  title?: string | null
}

const cardStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 16,
  padding: 18,
  background: "var(--surface)",
  boxShadow: "0 8px 24px rgba(15, 23, 42, 0.06)",
}

const badgeBase: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "3px 10px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 700,
}

const STATUS_META: Record<string, { label: string; bg: string; text: string }> = {
  draft: { label: "Draft", bg: "#f8fafc", text: "#475569" },
  issued: { label: "発行済み", bg: "#ecfdf5", text: "#166534" },
  void: { label: "無効", bg: "#fff1f2", text: "#be123c" },
}

function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0))
}

async function getAccessToken() {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

export default function InvoicesPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { activeOrgId: orgId, role, loading: authLoading } = useAuthOrg({ redirectToOnboarding: true })
  const canAccess = role === "owner" || role === "executive_assistant"

  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<InvoiceRow[]>([])
  const [clients, setClients] = useState<Record<string, ClientRow>>({})
  const [query, setQuery] = useState("")
  const [month, setMonth] = useState(searchParams.get("month") ?? "")
  const [statusFilter, setStatusFilter] = useState<"" | "draft" | "issued" | "void">("")
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [linesByInvoice, setLinesByInvoice] = useState<Record<string, InvoiceLineRow[]>>({})
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [sendSummary, setSendSummary] = useState<
    | null
    | {
        preparedAt: string
        recipients: Array<{
          invoiceId: string
          invoiceTitle: string
          recipientName: string
          companyName: string | null
          email: string | null
          address: string | null
          warning: string | null
        }>
      }
  >(null)

  useEffect(() => {
    if (!orgId || !canAccess) {
      setLoading(false)
      return
    }
    let active = true

    const load = async () => {
      setLoading(true)
      setError(null)
      const { data, error: invoiceError } = await supabase
        .from("invoices")
        .select("id, invoice_month, invoice_title, invoice_no, status, issue_date, due_date, subtotal, total, created_at, client_id, guest_client_name, guest_company_name, guest_client_email, pdf_path, send_prepared_at")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })

      if (!active) return
      if (invoiceError) {
        setRows([])
        setError(`請求書一覧の取得に失敗しました: ${invoiceError.message}`)
        setLoading(false)
        return
      }

      const invoiceRows = (data ?? []) as InvoiceRow[]
      setRows(invoiceRows)
      const clientIds = Array.from(new Set(invoiceRows.map((row) => row.client_id).filter(Boolean))) as string[]
      if (clientIds.length > 0) {
        const { data: clientRows } = await supabase
          .from("clients")
          .select("id, name, billing_name, billing_email")
          .in("id", clientIds)
        if (!active) return
        const map: Record<string, ClientRow> = {}
        for (const client of (clientRows ?? []) as ClientRow[]) map[client.id] = client
        setClients(map)
      } else {
        setClients({})
      }
      setLoading(false)
    }

    void load()
    return () => {
      active = false
    }
  }, [orgId, canAccess])

  useEffect(() => {
    if (!expandedId || linesByInvoice[expandedId]) return
    let active = true
    const loadLines = async () => {
      const { data, error: lineError } = await supabase
        .from("invoice_lines")
        .select("id, description, quantity, unit_price, amount, sort_order, project_name, title")
        .eq("invoice_id", expandedId)
        .order("sort_order", { ascending: true })
      if (!active) return
      if (lineError) {
        setError(`請求明細の取得に失敗しました: ${lineError.message}`)
        return
      }
      setLinesByInvoice((prev) => ({ ...prev, [expandedId]: (data ?? []) as InvoiceLineRow[] }))
    }
    void loadLines()
    return () => {
      active = false
    }
  }, [expandedId, linesByInvoice])

  const monthOptions = useMemo(
    () => ["", ...Array.from(new Set(rows.map((row) => row.invoice_month).filter(Boolean))).sort().reverse()],
    [rows]
  )

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((row) => {
      if (month && row.invoice_month !== month) return false
      if (statusFilter && row.status !== statusFilter) return false
      if (!q) return true
      const client = row.client_id ? clients[row.client_id] : null
      const target = [row.invoice_title, row.invoice_no, row.invoice_month, client?.name, row.guest_client_name, row.guest_company_name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return target.includes(q)
    })
  }, [rows, month, statusFilter, query, clients])

  const selectedRows = useMemo(
    () => filteredRows.filter((row) => selectedIds.includes(row.id)),
    [filteredRows, selectedIds]
  )

  const totalSelectedAmount = useMemo(
    () => selectedRows.reduce((sum, row) => sum + Number(row.total ?? row.subtotal ?? 0), 0),
    [selectedRows]
  )

  const toggleSelection = (invoiceId: string) => {
    setSelectedIds((prev) =>
      prev.includes(invoiceId) ? prev.filter((id) => id !== invoiceId) : [...prev, invoiceId]
    )
  }

  const toggleSelectAll = () => {
    if (selectedRows.length === filteredRows.length && filteredRows.length > 0) {
      setSelectedIds((prev) => prev.filter((id) => !filteredRows.some((row) => row.id === id)))
      return
    }
    setSelectedIds(Array.from(new Set([...selectedIds, ...filteredRows.map((row) => row.id)])))
  }

  const refreshInvoices = async () => {
    if (!orgId) return
    const { data } = await supabase
      .from("invoices")
      .select("id, invoice_month, invoice_title, invoice_no, status, issue_date, due_date, subtotal, total, created_at, client_id, guest_client_name, guest_company_name, guest_client_email, pdf_path, send_prepared_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
    setRows((data ?? []) as InvoiceRow[])
  }

  const openPdf = async (invoiceId: string) => {
    const token = await getAccessToken()
    if (!token) {
      setError("ログイン状態を確認できませんでした。")
      return
    }
    setBusyKey(`pdf:${invoiceId}`)
    setError(null)
    try {
      let res = await fetch(`/api/invoices/${invoiceId}/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 404) {
        await fetch(`/api/invoices/${invoiceId}/pdf`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        })
        res = await fetch(`/api/invoices/${invoiceId}/pdf`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      }
      const json = (await res.json().catch(() => null)) as { signed_url?: string; error?: string } | null
      if (!res.ok || !json?.signed_url) {
        setError(json?.error ?? "PDFを開けませんでした。")
        return
      }
      window.open(json.signed_url, "_blank", "noopener,noreferrer")
    } finally {
      setBusyKey(null)
    }
  }

  const copyInvoice = async (invoiceId: string) => {
    const token = await getAccessToken()
    if (!token) {
      setError("ログイン状態を確認できませんでした。")
      return
    }
    setBusyKey(`copy:${invoiceId}`)
    setError(null)
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/copy`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = (await res.json().catch(() => null)) as { ok?: boolean; invoiceId?: string; message?: string } | null
      if (!res.ok || !json?.ok || !json.invoiceId) {
        setError(json?.message ?? "請求書の複製に失敗しました。")
        return
      }
      router.push(`/invoices/${json.invoiceId}`)
    } finally {
      setBusyKey(null)
    }
  }

  const runBulkStatus = async (status: "draft" | "issued" | "void") => {
    if (!orgId || selectedRows.length === 0) return
    const confirmed = window.confirm(
      `${selectedRows.length}件の請求書を「${STATUS_META[status]?.label ?? status}」に変更します。`
    )
    if (!confirmed) return

    const token = await getAccessToken()
    if (!token) {
      setError("ログイン状態を確認できませんでした。")
      return
    }

    setBusyKey(`bulk-status:${status}`)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch("/api/invoices/bulk-update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          orgId,
          invoiceIds: selectedRows.map((row) => row.id),
          status,
        }),
      })
      const json = (await res.json().catch(() => null)) as { ok?: boolean; updatedCount?: number; error?: string } | null
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? "一括ステータス変更に失敗しました。")
        return
      }
      setSuccess(`${json.updatedCount ?? selectedRows.length}件のステータスを更新しました。`)
      setSelectedIds([])
      await refreshInvoices()
    } finally {
      setBusyKey(null)
    }
  }

  const runBulkPdf = async () => {
    if (selectedRows.length === 0) return
    const token = await getAccessToken()
    if (!token) {
      setError("ログイン状態を確認できませんでした。")
      return
    }

    setBusyKey("bulk-pdf")
    setError(null)
    try {
      if (selectedRows.length === 1) {
        await openPdf(selectedRows[0].id)
        return
      }

      const res = await fetch("/api/invoices/bulk-zip", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ invoiceIds: selectedRows.map((row) => row.id) }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { message?: string } | null
        setError(json?.message ?? "PDF ZIP の出力に失敗しました。")
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = `invoices_${new Date().toISOString().slice(0, 10)}.zip`
      anchor.click()
      URL.revokeObjectURL(url)
    } finally {
      setBusyKey(null)
    }
  }

  const prepareSend = async () => {
    if (!orgId || selectedRows.length === 0) return
    const confirmed = window.confirm(
      `${selectedRows.length}件の請求書を「送付準備済み」にします。メール自動送信は行わず、PDF送付の準備情報だけを残します。`
    )
    if (!confirmed) return

    const token = await getAccessToken()
    if (!token) {
      setError("ログイン状態を確認できませんでした。")
      return
    }

    setBusyKey("bulk-send")
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch("/api/invoices/bulk-send-prep", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          orgId,
          invoiceIds: selectedRows.map((row) => row.id),
        }),
      })
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean
        preparedAt?: string
        recipients?: Array<{
          invoiceId: string
          invoiceTitle: string
          recipientName: string
          companyName: string | null
          email: string | null
          address: string | null
          warning: string | null
        }>
        error?: string
      } | null
      if (!res.ok || !json?.ok || !json.preparedAt || !json.recipients) {
        setError(json?.error ?? "送付準備に失敗しました。")
        return
      }
      setSendSummary({ preparedAt: json.preparedAt, recipients: json.recipients })
      setSuccess(`${json.recipients.length}件を送付準備済みにしました。`)
      await refreshInvoices()
    } finally {
      setBusyKey(null)
    }
  }

  if (authLoading || loading) {
    return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  }

  if (!canAccess) {
    return (
      <div style={{ padding: 32 }}>
        <div style={cardStyle}>
          <h1 style={{ marginTop: 0, fontSize: 20 }}>請求書</h1>
          <p style={{ color: "var(--muted)" }}>請求関連の操作は owner / executive_assistant のみ利用できます。</p>
          <Link href="/home" style={{ color: "var(--primary)", fontWeight: 700 }}>
            Home に戻る
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-grad)", padding: "32px 40px 60px" }}>
      <div style={{ maxWidth: 1220, margin: "0 auto", display: "grid", gap: 16 }}>
        <header style={{ display: "grid", gap: 8 }}>
          <p style={{ margin: 0, fontSize: 12, letterSpacing: "0.08em", color: "var(--muted)" }}>INVOICES</p>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "end" }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 30, color: "var(--text)" }}>請求書一覧</h1>
              <p style={{ margin: "8px 0 0", color: "var(--muted)" }}>
                一括発行、一括PDF、一括送付準備、コピー新規をここから行います。
              </p>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link
                href="/invoices/new"
                style={{
                  padding: "10px 14px",
                  borderRadius: 12,
                  background: "var(--button-primary-bg)",
                  color: "var(--primary-contrast)",
                  textDecoration: "none",
                  fontWeight: 700,
                }}
              >
                新規請求書
              </Link>
              <Link
                href="/billing"
                style={{
                  padding: "10px 14px",
                  borderRadius: 12,
                  border: "1px solid var(--border)",
                  background: "var(--surface)",
                  color: "var(--text)",
                  textDecoration: "none",
                  fontWeight: 700,
                }}
              >
                Billing を開く
              </Link>
            </div>
          </div>
        </header>

        <section style={{ ...cardStyle, display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1.6fr) repeat(2, minmax(140px, 180px))", gap: 10 }}>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="請求名、請求番号、取引先で検索"
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--input-bg)" }}
            />
            <select
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--input-bg)" }}
            >
              {monthOptions.map((option) => (
                <option key={option || "all"} value={option}>
                  {option || "すべての月"}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as "" | "draft" | "issued" | "void")}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--input-bg)" }}
            >
              <option value="">すべてのステータス</option>
              <option value="draft">Draft</option>
              <option value="issued">発行済み</option>
              <option value="void">無効</option>
            </select>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
            <SummaryCard label="表示件数" value={String(filteredRows.length)} />
            <SummaryCard label="選択件数" value={String(selectedRows.length)} />
            <SummaryCard label="選択合計" value={formatCurrency(totalSelectedAmount)} />
            <SummaryCard label="送付準備済み" value={String(filteredRows.filter((row) => row.send_prepared_at).length)} />
          </div>
        </section>

        <section style={{ ...cardStyle, display: "grid", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 700, color: "var(--text)" }}>一括操作</div>
              <div style={{ marginTop: 4, fontSize: 13, color: "var(--muted)" }}>
                {selectedRows.length}件選択中。発行済みにする前に金額と宛先を確認してください。
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={toggleSelectAll} style={secondaryButtonStyle}>
                {selectedRows.length === filteredRows.length && filteredRows.length > 0 ? "全解除" : "表示中をすべて選択"}
              </button>
              <button type="button" disabled={selectedRows.length === 0 || busyKey !== null} onClick={() => void runBulkStatus("issued")} style={secondaryButtonStyle}>
                一括発行
              </button>
              <button type="button" disabled={selectedRows.length === 0 || busyKey !== null} onClick={() => void runBulkStatus("draft")} style={secondaryButtonStyle}>
                Draftに戻す
              </button>
              <button type="button" disabled={selectedRows.length === 0 || busyKey !== null} onClick={() => void runBulkStatus("void")} style={secondaryButtonStyle}>
                一括無効化
              </button>
              <button type="button" disabled={selectedRows.length === 0 || busyKey !== null} onClick={() => void runBulkPdf()} style={secondaryButtonStyle}>
                {selectedRows.length > 1 ? "一括PDF ZIP" : "PDF"}
              </button>
              <button type="button" disabled={selectedRows.length === 0 || busyKey !== null} onClick={() => void prepareSend()} style={primaryButtonStyle}>
                一括送付準備
              </button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12, color: "var(--muted)" }}>
            <span>Draft: まだ社外に出していない状態</span>
            <span>発行済み: PDF送付または送付準備に進める状態</span>
            <span>無効: 参照用に残すが運用対象から外す状態</span>
          </div>
        </section>

        {error ? (
          <section style={{ ...cardStyle, borderColor: "#fecaca", background: "#fff1f2", color: "#b91c1c" }}>{error}</section>
        ) : null}
        {success ? (
          <section style={{ ...cardStyle, borderColor: "#bbf7d0", background: "#f0fdf4", color: "#166534" }}>{success}</section>
        ) : null}

        {sendSummary ? (
          <section style={{ ...cardStyle, display: "grid", gap: 12 }}>
            <div>
              <div style={{ fontWeight: 700, color: "var(--text)" }}>送付準備サマリ</div>
              <div style={{ marginTop: 4, color: "var(--muted)", fontSize: 13 }}>
                {sendSummary.preparedAt.slice(0, 16).replace("T", " ")} に更新しました。自動メール送信は行っていません。
              </div>
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              {sendSummary.recipients.map((recipient) => (
                <div key={recipient.invoiceId} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
                  <div style={{ fontWeight: 700, color: "var(--text)" }}>{recipient.invoiceTitle}</div>
                  <div style={{ marginTop: 4, fontSize: 13, color: "var(--muted)" }}>
                    宛先: {recipient.recipientName}
                    {recipient.companyName ? ` / ${recipient.companyName}` : ""}
                    {recipient.email ? ` / ${recipient.email}` : ""}
                  </div>
                  {recipient.address ? <div style={{ marginTop: 4, fontSize: 13, color: "var(--muted)" }}>{recipient.address}</div> : null}
                  {recipient.warning ? <div style={{ marginTop: 6, color: "#b45309", fontSize: 13 }}>{recipient.warning}</div> : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section style={{ display: "grid", gap: 12 }}>
          {filteredRows.length === 0 ? (
            <section style={cardStyle}>
              <GuideEmptyState
                title="請求書はまだありません"
                description="Billing から月次生成するか、手動請求書を作成すると一覧に並びます。"
                primaryHref="/billing"
                primaryLabel="Billing を開く"
                helpHref="/help/billing-monthly"
              />
            </section>
          ) : (
            filteredRows.map((row) => {
              const client = row.client_id ? clients[row.client_id] : null
              const recipientName = resolveInvoiceRecipientLabel({
                clientName: client?.billing_name || client?.name,
                guestCompanyName: row.guest_company_name,
                guestClientName: row.guest_client_name,
              })
              const status = STATUS_META[row.status] ?? { label: row.status, bg: "#f8fafc", text: "#475569" }
              const isSelected = selectedIds.includes(row.id)
              const isExpanded = expandedId === row.id
              const lines = linesByInvoice[row.id] ?? []

              return (
                <article key={row.id} style={{ ...cardStyle, borderColor: isSelected ? "var(--primary)" : "var(--border)" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr) auto", gap: 14, alignItems: "start" }}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggleSelection(row.id)} style={{ marginTop: 6 }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <Link href={`/invoices/${row.id}`} style={{ color: "var(--text)", fontWeight: 700, textDecoration: "none" }}>
                          {row.invoice_title || "請求書"}
                        </Link>
                        <span style={{ ...badgeBase, background: status.bg, color: status.text }}>{status.label}</span>
                        {(row.guest_company_name || row.guest_client_name) ? (
                          <span style={{ ...badgeBase, background: "#eef2ff", color: "#3730a3" }}>ゲスト宛先</span>
                        ) : null}
                        {row.send_prepared_at ? (
                          <span style={{ ...badgeBase, background: "#ecfeff", color: "#155e75" }}>送付準備済み</span>
                        ) : null}
                      </div>
                      <div style={{ marginTop: 8, display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13, color: "var(--muted)" }}>
                        <span>宛先: {recipientName}</span>
                        <span>請求番号: {row.invoice_no || "未採番"}</span>
                        <span>対象月: {row.invoice_month}</span>
                        <span>請求日: {row.issue_date}</span>
                        <span>支払期限: {row.due_date}</span>
                        {client?.billing_email || row.guest_client_email ? (
                          <span>メール: {client?.billing_email || row.guest_client_email}</span>
                        ) : null}
                      </div>
                    </div>
                    <div style={{ minWidth: 240, textAlign: "right" }}>
                      <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>{formatCurrency(row.total ?? row.subtotal)}</div>
                      <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                        <button type="button" onClick={() => setExpandedId((prev) => (prev === row.id ? null : row.id))} style={secondaryButtonStyle}>
                          {isExpanded ? "明細を閉じる" : "明細を見る"}
                        </button>
                        <button type="button" onClick={() => void openPdf(row.id)} disabled={busyKey === `pdf:${row.id}`} style={secondaryButtonStyle}>
                          PDF
                        </button>
                        <button type="button" onClick={() => void copyInvoice(row.id)} disabled={busyKey === `copy:${row.id}`} style={secondaryButtonStyle}>
                          複製して新規
                        </button>
                      </div>
                    </div>
                  </div>

                  {isExpanded ? (
                    <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border)", display: "grid", gap: 10 }}>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 13, color: "var(--muted)" }}>
                        <span>前月コピーや定型請求は「複製して新規」で draft を作り直してください。</span>
                        <span>元の請求書は編集されません。</span>
                      </div>
                      {lines.length === 0 ? (
                        <div style={{ color: "var(--muted)" }}>明細はありません。</div>
                      ) : (
                        <div style={{ display: "grid", gap: 8 }}>
                          {lines.map((line) => (
                            <div key={line.id} style={{ display: "grid", gridTemplateColumns: "1.1fr 1.3fr auto auto auto", gap: 10, fontSize: 13, alignItems: "center" }}>
                              <span>{line.project_name || "-"}</span>
                              <span>{line.title || line.description || "明細"}</span>
                              <span>{line.quantity}</span>
                              <span>{formatCurrency(line.unit_price)}</span>
                              <strong>{formatCurrency(line.amount)}</strong>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}
                </article>
              )
            })
          )}
        </section>
      </div>
    </div>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface-2)" }}>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{label}</div>
      <div style={{ marginTop: 6, fontSize: 22, fontWeight: 700, color: "var(--text)" }}>{value}</div>
    </div>
  )
}

const secondaryButtonStyle: CSSProperties = {
  padding: "9px 12px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--surface-2)",
  color: "var(--text)",
  fontWeight: 600,
  cursor: "pointer",
}

const primaryButtonStyle: CSSProperties = {
  padding: "9px 12px",
  borderRadius: 10,
  border: "1px solid var(--button-primary-bg)",
  background: "var(--button-primary-bg)",
  color: "var(--primary-contrast)",
  fontWeight: 700,
  cursor: "pointer",
}
