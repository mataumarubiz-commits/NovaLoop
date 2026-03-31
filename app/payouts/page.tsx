"use client"

import Link from "next/link"
import { useEffect, useMemo, useState, type CSSProperties } from "react"
import { supabase } from "@/lib/supabase"
import { useAuthOrg } from "@/hooks/useAuthOrg"

type VendorInvoiceRow = {
  id: string
  vendor_id: string
  billing_month: string
  status: string
  submit_deadline: string
  pay_date: string
  total: number
}

type VendorRow = {
  id: string
  name: string
  bank_name: string | null
  bank_branch: string | null
  bank_account_type: string | null
  bank_account_number: string | null
  bank_account_holder_kana: string | null
}

type CsvSettings = {
  payout_csv_format: "zengin_simple" | "custom_basic" | "freee_vendor" | "zengin_standard"
  payout_csv_encoding: string
  payout_csv_depositor_code: string
  payout_csv_company_name_kana: string
  payout_csv_notes: string
}

type CsvPreviewRow = {
  invoiceId: string
  vendorName: string
  payDate: string
  amount: number
  bankName: string
  branchName: string
  bankCode: string
  branchCode: string
  accountType: string
  accountNumber: string
  accountHolderKana: string
  status: string
  warning: string | null
}

type CsvHistoryRow = {
  id: string
  export_month: string
  format: string
  encoding: string
  file_name: string
  line_count: number
  total_amount: number
  created_at: string
}

type PayoutStatusFilter = "all" | "draft" | "submitted" | "approved" | "rejected" | "paid"
type BankFilter = "all" | "missing" | "ready"

const cardStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 16,
  padding: 18,
  background: "var(--surface)",
  boxShadow: "var(--shadow-md)",
}

const STATUS_META: Record<string, { label: string; bg: string; text: string }> = {
  draft: { label: "未確認", bg: "#f8fafc", text: "#475569" },
  submitted: { label: "提出済み", bg: "#eff6ff", text: "#1d4ed8" },
  approved: { label: "承認済み", bg: "var(--success-bg)", text: "var(--success-text)" },
  rejected: { label: "差し戻し", bg: "var(--warning-bg)", text: "var(--warning-text)" },
  paid: { label: "支払済み", bg: "#f3e8ff", text: "#7e22ce" },
}

const FORMAT_LABELS: Record<CsvSettings["payout_csv_format"], string> = {
  zengin_simple: "全銀CSV（簡易）",
  zengin_standard: "全銀CSV（標準）",
  freee_vendor: "freee支払CSV",
  custom_basic: "汎用CSV",
}

const FORMAT_HELP: Record<CsvSettings["payout_csv_format"], string> = {
  zengin_simple: "日次運用向けのシンプルCSVです。",
  zengin_standard: "Shift_JIS固定長の全銀標準形式です。銀行コードが足りない行は警告します。",
  freee_vendor: "freee の支払インポートで扱いやすい列順です。",
  custom_basic: "社内確認や別ツール連携向けの汎用CSVです。",
}

function currentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
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

function downloadBase64File(base64: string, fileName: string) {
  const binary = atob(base64)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  const blob = new Blob([bytes])
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function PayoutsPage() {
  const { activeOrgId, role, loading } = useAuthOrg({ redirectToOnboarding: true })
  const canUse = role === "owner" || role === "executive_assistant"

  const [rows, setRows] = useState<VendorInvoiceRow[]>([])
  const [vendors, setVendors] = useState<VendorRow[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [month, setMonth] = useState(currentMonth())
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<PayoutStatusFilter>("all")
  const [bankFilter, setBankFilter] = useState<BankFilter>("all")
  const [csvSettings, setCsvSettings] = useState<CsvSettings>({
    payout_csv_format: "zengin_simple",
    payout_csv_encoding: "utf8_bom",
    payout_csv_depositor_code: "",
    payout_csv_company_name_kana: "",
    payout_csv_notes: "",
  })
  const [csvPreview, setCsvPreview] = useState<CsvPreviewRow[]>([])
  const [csvNotes, setCsvNotes] = useState<string[]>([])
  const [csvHistory, setCsvHistory] = useState<CsvHistoryRow[]>([])

  useEffect(() => {
    if (!activeOrgId || !canUse) return
    let active = true

    const load = async () => {
      const token = await getAccessToken()
      if (!token) {
        setError("ログイン状態を確認できませんでした。")
        return
      }

      const [invoiceRes, vendorRes, settingsRes, historyRes] = await Promise.all([
        supabase
          .from("vendor_invoices")
          .select("id, vendor_id, billing_month, status, submit_deadline, pay_date, total")
          .eq("org_id", activeOrgId)
          .order("pay_date", { ascending: false }),
        supabase
          .from("vendors")
          .select("id, name, bank_name, bank_branch, bank_account_type, bank_account_number, bank_account_holder_kana")
          .eq("org_id", activeOrgId)
          .order("name"),
        fetch("/api/org-settings", { headers: { Authorization: `Bearer ${token}` } }).then((res) => res.json().catch(() => null)),
        fetch(`/api/payouts/csv-export?orgId=${encodeURIComponent(activeOrgId)}`, { headers: { Authorization: `Bearer ${token}` } }).then((res) => res.json().catch(() => null)),
      ])

      if (!active) return

      setRows((invoiceRes.data ?? []) as VendorInvoiceRow[])
      setVendors((vendorRes.data ?? []) as VendorRow[])
      if (invoiceRes.error) setError(invoiceRes.error.message)

      if (settingsRes?.settings) {
        setCsvSettings((prev) => ({
          ...prev,
          payout_csv_format: settingsRes.settings.payout_csv_format ?? prev.payout_csv_format,
          payout_csv_encoding: settingsRes.settings.payout_csv_encoding ?? prev.payout_csv_encoding,
          payout_csv_depositor_code: settingsRes.settings.payout_csv_depositor_code ?? "",
          payout_csv_company_name_kana: settingsRes.settings.payout_csv_company_name_kana ?? "",
          payout_csv_notes: settingsRes.settings.payout_csv_notes ?? "",
        }))
      }

      setCsvHistory((historyRes?.exports ?? []) as CsvHistoryRow[])
    }

    void load()
    return () => {
      active = false
    }
  }, [activeOrgId, canUse])

  const vendorMap = useMemo(() => new Map(vendors.map((vendor) => [vendor.id, vendor])), [vendors])
  const monthOptions = useMemo(() => {
    const values = [...new Set(rows.map((row) => row.pay_date.slice(0, 7)).filter(Boolean))]
    return values.length > 0 ? values.sort().reverse() : [currentMonth()]
  }, [rows])

  const monthRows = useMemo(() => rows.filter((row) => row.pay_date.slice(0, 7) === month), [month, rows])
  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    return monthRows.filter((row) => {
      const vendor = vendorMap.get(row.vendor_id)
      const bankMissing =
        !vendor?.bank_name ||
        !vendor?.bank_branch ||
        !vendor?.bank_account_type ||
        !vendor?.bank_account_number ||
        !vendor?.bank_account_holder_kana
      const haystack = [vendor?.name, vendor?.bank_name, vendor?.bank_branch].filter(Boolean).join(" ").toLowerCase()
      const matchesQuery = !query || haystack.includes(query)
      const matchesStatus = statusFilter === "all" || row.status === statusFilter
      const matchesBank = bankFilter === "all" || (bankFilter === "missing" ? bankMissing : !bankMissing)
      return matchesQuery && matchesStatus && matchesBank
    })
  }, [bankFilter, monthRows, search, statusFilter, vendorMap])

  const selectedRows = useMemo(() => filteredRows.filter((row) => selectedIds.includes(row.id)), [filteredRows, selectedIds])
  const selectedTotal = useMemo(() => selectedRows.reduce((sum, row) => sum + Number(row.total ?? 0), 0), [selectedRows])

  const monthSummary = useMemo(
    () => ({
      missingBank: monthRows.filter((row) => {
        const vendor = vendorMap.get(row.vendor_id)
        return (
          !vendor?.bank_name ||
          !vendor?.bank_branch ||
          !vendor?.bank_account_type ||
          !vendor?.bank_account_number ||
          !vendor?.bank_account_holder_kana
        )
      }).length,
      pending: monthRows.filter((row) => row.status === "submitted" || row.status === "approved").length,
      paid: monthRows.filter((row) => row.status === "paid").length,
    }),
    [monthRows, vendorMap]
  )

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]))
  }

  const toggleSelectAll = () => {
    if (selectedRows.length === filteredRows.length && filteredRows.length > 0) {
      setSelectedIds((prev) => prev.filter((id) => !filteredRows.some((row) => row.id === id)))
      return
    }
    setSelectedIds(Array.from(new Set([...selectedIds, ...filteredRows.map((row) => row.id)])))
  }

  const refreshHistory = async (token: string) => {
    if (!activeOrgId) return
    const historyRes = await fetch(`/api/payouts/csv-export?orgId=${encodeURIComponent(activeOrgId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const historyJson = await historyRes.json().catch(() => null)
    setCsvHistory((historyJson?.exports ?? []) as CsvHistoryRow[])
  }

  const bulkUpdate = async (status: "approved" | "rejected" | "paid") => {
    if (!activeOrgId || selectedRows.length === 0) return
    if (!window.confirm(`${selectedRows.length}件を「${STATUS_META[status]?.label ?? status}」に変更します。`)) return

    const token = await getAccessToken()
    if (!token) {
      setError("ログイン状態を確認できませんでした。")
      return
    }

    setBusyKey(`status:${status}`)
    setError(null)
    setSuccess(null)
    const res = await fetch("/api/payouts/bulk-update", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        orgId: activeOrgId,
        invoiceIds: selectedRows.map((row) => row.id),
        status,
      }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) {
      setError(json?.error ?? "一括更新に失敗しました。")
    } else {
      setRows((prev) => prev.map((row) => (selectedRows.some((selected) => selected.id === row.id) ? { ...row, status } : row)))
      setSelectedIds([])
      setSuccess(`${json.updatedCount ?? selectedRows.length}件を更新しました。`)
    }
    setBusyKey(null)
  }

  const downloadZip = async () => {
    const token = await getAccessToken()
    if (!token || selectedRows.length === 0) return
    setBusyKey("zip")
    setError(null)
    try {
      const res = await fetch("/api/vendor-invoices/bulk-zip", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ invoiceIds: selectedRows.map((row) => row.id) }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        setError(json?.error ?? "PDF ZIP の出力に失敗しました。")
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = `vendor_invoices_${month}.zip`
      anchor.click()
      URL.revokeObjectURL(url)
    } finally {
      setBusyKey(null)
    }
  }

  const saveCsvSettings = async () => {
    if (!activeOrgId) return
    const token = await getAccessToken()
    if (!token) {
      setError("ログイン状態を確認できませんでした。")
      return
    }
    setBusyKey("save-settings")
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch("/api/org-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(csvSettings),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) {
        setError(json?.message ?? "CSV設定の保存に失敗しました。")
        return
      }
      setSuccess("CSV設定を保存しました。")
    } finally {
      setBusyKey(null)
    }
  }

  const previewCsv = async () => {
    if (!activeOrgId || selectedRows.length === 0) return
    const token = await getAccessToken()
    if (!token) {
      setError("ログイン状態を確認できませんでした。")
      return
    }
    setBusyKey("csv-preview")
    setError(null)
    try {
      const res = await fetch("/api/payouts/csv-export", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          orgId: activeOrgId,
          invoiceIds: selectedRows.map((row) => row.id),
          exportMonth: month,
          mode: "preview",
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? "CSVプレビューの取得に失敗しました。")
        return
      }
      setCsvPreview((json.rows ?? []) as CsvPreviewRow[])
      setCsvNotes((json.notes ?? []) as string[])
      if (json.settings) {
        setCsvSettings((prev) => ({
          ...prev,
          payout_csv_format: json.settings.payout_csv_format ?? prev.payout_csv_format,
          payout_csv_encoding: json.settings.payout_csv_encoding ?? prev.payout_csv_encoding,
          payout_csv_depositor_code: json.settings.payout_csv_depositor_code ?? prev.payout_csv_depositor_code,
          payout_csv_company_name_kana: json.settings.payout_csv_company_name_kana ?? prev.payout_csv_company_name_kana,
          payout_csv_notes: json.settings.payout_csv_notes ?? prev.payout_csv_notes,
        }))
      }
    } finally {
      setBusyKey(null)
    }
  }

  const exportCsv = async () => {
    if (!activeOrgId || selectedRows.length === 0) return
    const token = await getAccessToken()
    if (!token) {
      setError("ログイン状態を確認できませんでした。")
      return
    }

    setBusyKey("csv-export")
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch("/api/payouts/csv-export", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          orgId: activeOrgId,
          invoiceIds: selectedRows.map((row) => row.id),
          exportMonth: month,
          mode: "export",
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok || typeof json.contentBase64 !== "string" || typeof json.fileName !== "string") {
        setError(json?.error ?? "CSV出力に失敗しました。")
        return
      }

      downloadBase64File(json.contentBase64, json.fileName)
      setSuccess(`${json.lineCount ?? selectedRows.length}件の支払CSVを出力しました。`)
      await refreshHistory(token)
    } finally {
      setBusyKey(null)
    }
  }

  if (loading) return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  if (!activeOrgId) return <div style={{ padding: 32, color: "var(--muted)" }}>ワークスペースを選択してください。</div>
  if (!canUse) return <div style={{ padding: 32, color: "var(--muted)" }}>owner / executive_assistant のみ利用できます。</div>

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-grad)", padding: "32px 40px 60px" }}>
      <div style={{ maxWidth: 1220, margin: "0 auto", display: "grid", gap: 16 }}>
        <nav className="page-tab-bar">
          <Link href="/vendors" data-active="false">外注管理</Link>
          <Link href="/payouts" data-active="true">支払</Link>
        </nav>

        <header style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "end" }}>
          <div>
            <p style={{ margin: 0, fontSize: 12, letterSpacing: "0.08em", color: "var(--muted)" }}>PAYOUTS</p>
            <h1 style={{ margin: "6px 0 8px", fontSize: 30, color: "var(--text)" }}>支払管理</h1>
            <p style={{ margin: 0, color: "var(--muted)" }}>
              承認、支払済み更新、CSV出力、PDF ZIP を同じ画面で扱えます。
            </p>
          </div>
          <select value={month} onChange={(event) => setMonth(event.target.value)} style={inputStyle}>
            {monthOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </header>

        <section style={{ ...cardStyle, display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 10 }}>
          <SummaryCard label="対象件数" value={String(filteredRows.length)} />
          <SummaryCard label="選択中" value={String(selectedRows.length)} />
          <SummaryCard label="選択金額" value={formatCurrency(selectedTotal)} />
          <SummaryCard label="口座未設定" value={String(monthSummary.missingBank)} />
          <SummaryCard label="支払済み" value={String(monthSummary.paid)} />
        </section>

        <section style={{ ...cardStyle, display: "grid", gridTemplateColumns: "minmax(220px, 1.4fr) repeat(2, minmax(180px, 0.8fr))", gap: 10 }}>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="外注名 / 銀行名 / 支店名で検索"
            style={inputStyle}
          />
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as PayoutStatusFilter)} style={inputStyle}>
            <option value="all">すべての状態</option>
            <option value="draft">未確認</option>
            <option value="submitted">提出済み</option>
            <option value="approved">承認済み</option>
            <option value="rejected">差し戻し</option>
            <option value="paid">支払済み</option>
          </select>
          <select value={bankFilter} onChange={(event) => setBankFilter(event.target.value as BankFilter)} style={inputStyle}>
            <option value="all">口座状態を問わない</option>
            <option value="missing">口座未設定のみ</option>
            <option value="ready">口座設定済みのみ</option>
          </select>
        </section>

        {error ? <section style={{ ...cardStyle, borderColor: "var(--error-border)", background: "var(--error-bg)", color: "var(--error-text)" }}>{error}</section> : null}
        {success ? <section style={{ ...cardStyle, borderColor: "var(--success-border)", background: "var(--success-bg)", color: "var(--success-text)" }}>{success}</section> : null}

        <section style={{ ...cardStyle, display: "grid", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 800, color: "var(--text)" }}>一括操作</div>
              <div style={{ marginTop: 4, fontSize: 13, color: "var(--muted)" }}>
                {selectedRows.length}件を選択中。承認、支払済み、PDF ZIP、CSV出力をまとめて実行できます。
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={toggleSelectAll} style={secondaryButtonStyle}>
                {selectedRows.length === filteredRows.length && filteredRows.length > 0 ? "表示中を解除" : "表示中を全選択"}
              </button>
              <button type="button" disabled={selectedRows.length === 0 || busyKey !== null} onClick={() => void bulkUpdate("approved")} style={secondaryButtonStyle}>
                一括承認
              </button>
              <button type="button" disabled={selectedRows.length === 0 || busyKey !== null} onClick={() => void bulkUpdate("rejected")} style={secondaryButtonStyle}>
                一括差し戻し
              </button>
              <button type="button" disabled={selectedRows.length === 0 || busyKey !== null} onClick={() => void bulkUpdate("paid")} style={secondaryButtonStyle}>
                一括支払済み
              </button>
              <button type="button" disabled={selectedRows.length === 0 || busyKey !== null} onClick={() => void downloadZip()} style={secondaryButtonStyle}>
                PDF ZIP
              </button>
              <button type="button" disabled={selectedRows.length === 0 || busyKey !== null} onClick={() => void previewCsv()} style={primaryButtonStyle}>
                CSVプレビュー
              </button>
            </div>
          </div>
        </section>

        <section style={{ ...cardStyle, display: "grid", gap: 14 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>支払CSV設定</h2>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)" }}>
              形式ごとの違いは下の説明に固定し、入力項目は増やしすぎない構成にしています。
            </p>
          </div>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
            <select
              value={csvSettings.payout_csv_format}
              onChange={(event) =>
                setCsvSettings((prev) => ({
                  ...prev,
                  payout_csv_format: event.target.value as CsvSettings["payout_csv_format"],
                }))
              }
              style={inputStyle}
            >
              {Object.entries(FORMAT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <input
              value={csvSettings.payout_csv_depositor_code}
              onChange={(event) => setCsvSettings((prev) => ({ ...prev, payout_csv_depositor_code: event.target.value }))}
              placeholder="委託者コード"
              style={inputStyle}
            />
            <input
              value={csvSettings.payout_csv_company_name_kana}
              onChange={(event) => setCsvSettings((prev) => ({ ...prev, payout_csv_company_name_kana: event.target.value }))}
              placeholder="会社名カナ"
              style={inputStyle}
            />
          </div>
          <textarea
            value={csvSettings.payout_csv_notes}
            onChange={(event) => setCsvSettings((prev) => ({ ...prev, payout_csv_notes: event.target.value }))}
            rows={3}
            placeholder="freee向けの補足や社内メモ"
            style={{ ...inputStyle, resize: "vertical" }}
          />
          <div style={{ padding: "12px 14px", borderRadius: 12, background: "var(--surface-2)", color: "var(--muted)", fontSize: 13 }}>
            {FORMAT_HELP[csvSettings.payout_csv_format]}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="button" onClick={() => void saveCsvSettings()} disabled={busyKey !== null} style={secondaryButtonStyle}>
              CSV設定を保存
            </button>
          </div>
        </section>

        <section style={{ ...cardStyle, display: "grid", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>CSVプレビュー</h2>
              <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)" }}>
                形式別の差分は preview で確認してから出力します。
              </p>
            </div>
            <button type="button" disabled={csvPreview.length === 0 || busyKey !== null} onClick={() => void exportCsv()} style={primaryButtonStyle}>
              CSVを出力
            </button>
          </div>

          {csvPreview.length === 0 ? (
            <div style={{ color: "var(--muted)" }}>選択中の支払データでプレビューを作成してください。</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {csvPreview.map((row) => (
                <div key={row.invoiceId} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <strong>{row.vendorName}</strong>
                    <span>{formatCurrency(row.amount)}</span>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 13, color: "var(--muted)", display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <span>支払日: {row.payDate}</span>
                    <span>銀行: {row.bankName || "-"}</span>
                    <span>支店: {row.branchName || "-"}</span>
                    <span>コード: {row.bankCode || "0000"} / {row.branchCode || "000"}</span>
                    <span>口座: {row.accountType || "-"} / {row.accountNumber || "-"}</span>
                  </div>
                  {row.warning ? <div style={{ marginTop: 6, color: "var(--warning-text)", fontSize: 13 }}>{row.warning}</div> : null}
                </div>
              ))}
            </div>
          )}

          {csvNotes.length > 0 ? (
            <div style={{ display: "grid", gap: 6, fontSize: 13, color: "var(--muted)" }}>
              {csvNotes.map((note) => (
                <div key={note}>- {note}</div>
              ))}
            </div>
          ) : null}
        </section>

        <section style={{ ...cardStyle, display: "grid", gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>CSV出力履歴</h2>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)" }}>
              どの月をどの形式で出したかだけを軽く残します。
            </p>
          </div>
          {csvHistory.length === 0 ? (
            <div style={{ color: "var(--muted)" }}>まだ履歴はありません。</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {csvHistory.map((history) => (
                <div key={history.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
                  <div>
                    <div style={{ fontWeight: 700, color: "var(--text)" }}>{history.file_name}</div>
                    <div style={{ marginTop: 4, fontSize: 13, color: "var(--muted)" }}>
                      {history.export_month} / {FORMAT_LABELS[history.format as CsvSettings["payout_csv_format"]] ?? history.format} / {history.encoding}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 700, color: "var(--text)" }}>{formatCurrency(history.total_amount)}</div>
                    <div style={{ marginTop: 4, fontSize: 13, color: "var(--muted)" }}>{new Date(history.created_at).toLocaleString("ja-JP")}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section style={{ display: "grid", gap: 12 }}>
          {filteredRows.length === 0 ? (
            <div style={{ ...cardStyle, color: "var(--muted)" }}>
              条件に合う支払対象はありません。状態や口座フィルタを確認してください。
            </div>
          ) : (
            filteredRows.map((row) => {
              const vendor = vendorMap.get(row.vendor_id)
              const status = STATUS_META[row.status] ?? { label: row.status, bg: "#f8fafc", text: "#475569" }
              const selected = selectedIds.includes(row.id)
              const bankMissing =
                !vendor?.bank_name ||
                !vendor?.bank_branch ||
                !vendor?.bank_account_type ||
                !vendor?.bank_account_number ||
                !vendor?.bank_account_holder_kana

              return (
                <article key={row.id} style={{ ...cardStyle, borderColor: selected ? "var(--primary)" : "var(--border)" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr) auto", gap: 14, alignItems: "start" }}>
                    <input type="checkbox" checked={selected} onChange={() => toggleSelection(row.id)} style={{ marginTop: 6 }} />
                    <div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <strong style={{ color: "var(--text)" }}>{vendor?.name ?? "外注名未設定"}</strong>
                        <span style={{ ...badgeBase, background: status.bg, color: status.text }}>{status.label}</span>
                        {bankMissing ? <span style={{ ...badgeBase, background: "var(--warning-bg)", color: "var(--warning-text)" }}>口座不足</span> : null}
                      </div>
                      <div style={{ marginTop: 8, display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13, color: "var(--muted)" }}>
                        <span>対象月: {row.billing_month}</span>
                        <span>提出期限: {row.submit_deadline}</span>
                        <span>支払予定日: {row.pay_date}</span>
                        <span>口座: {vendor?.bank_name || "-"} / {vendor?.bank_branch || "-"}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>{formatCurrency(row.total)}</div>
                      <div style={{ marginTop: 10 }}>
                        <Link href={`/vendors/${row.vendor_id}/invoices/${row.id}`} style={linkButtonStyle}>
                          詳細を見る
                        </Link>
                      </div>
                    </div>
                  </div>
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

const inputStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--input-bg)",
}

const badgeBase: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "3px 10px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 700,
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

const linkButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "9px 12px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--surface-2)",
  color: "var(--text)",
  fontWeight: 600,
  textDecoration: "none",
}
