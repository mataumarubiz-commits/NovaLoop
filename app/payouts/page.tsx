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
  payout_csv_format: "zengin_simple" | "custom_basic"
  payout_csv_encoding: "utf8_bom"
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

const cardStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 16,
  padding: 18,
  background: "var(--surface)",
  boxShadow: "0 8px 24px rgba(15, 23, 42, 0.06)",
}

const STATUS_META: Record<string, { label: string; bg: string; text: string }> = {
  draft: { label: "未確認", bg: "#f8fafc", text: "#475569" },
  submitted: { label: "提出済み", bg: "#eff6ff", text: "#1d4ed8" },
  approved: { label: "承認済み", bg: "#ecfdf5", text: "#166534" },
  rejected: { label: "差し戻し", bg: "#fff7ed", text: "#9a3412" },
  paid: { label: "支払済み", bg: "#f3e8ff", text: "#7e22ce" },
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
      ]).then((results) => [results[0], results[1], results[2], results[3]] as const)

      if (!active) return
      setRows((invoiceRes.data ?? []) as VendorInvoiceRow[])
      setVendors((vendorRes.data ?? []) as VendorRow[])
      if (invoiceRes.error) setError(invoiceRes.error.message)
      if (settingsRes?.settings) {
        setCsvSettings((prev) => ({
          ...prev,
          payout_csv_format: settingsRes.settings.payout_csv_format ?? prev.payout_csv_format,
          payout_csv_encoding: "utf8_bom",
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
  const filteredRows = useMemo(() => rows.filter((row) => row.pay_date.slice(0, 7) === month), [rows, month])
  const selectedRows = useMemo(() => filteredRows.filter((row) => selectedIds.includes(row.id)), [filteredRows, selectedIds])
  const selectedTotal = useMemo(() => selectedRows.reduce((sum, row) => sum + Number(row.total ?? 0), 0), [selectedRows])

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

  const bulkUpdate = async (status: "approved" | "rejected" | "paid") => {
    if (!activeOrgId || selectedRows.length === 0) return
    const confirmed = window.confirm(`${selectedRows.length}件を「${STATUS_META[status]?.label ?? status}」に変更します。`)
    if (!confirmed) return

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
      setRows((prev) =>
        prev.map((row) =>
          selectedRows.some((selected) => selected.id === row.id)
            ? { ...row, status }
            : row
        )
      )
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
      setSuccess("銀行CSV設定を保存しました。")
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
          payout_csv_encoding: "utf8_bom",
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
      if (!res.ok || !json?.ok || typeof json.csv !== "string" || typeof json.fileName !== "string") {
        setError(json?.error ?? "CSV出力に失敗しました。")
        return
      }

      const blob = new Blob([json.csv], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = json.fileName
      anchor.click()
      URL.revokeObjectURL(url)
      setSuccess(`${json.lineCount ?? selectedRows.length}件の支払CSVを出力しました。`)

      const historyRes = await fetch(`/api/payouts/csv-export?orgId=${encodeURIComponent(activeOrgId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const historyJson = await historyRes.json().catch(() => null)
      setCsvHistory((historyJson?.exports ?? []) as CsvHistoryRow[])
    } finally {
      setBusyKey(null)
    }
  }

  if (loading) return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  if (!activeOrgId) return <div style={{ padding: 32, color: "var(--muted)" }}>Workspace を選択してください。</div>
  if (!canUse) return <div style={{ padding: 32, color: "var(--muted)" }}>owner / executive_assistant のみ利用できます。</div>

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-grad)", padding: "32px 40px 60px" }}>
      <div style={{ maxWidth: 1220, margin: "0 auto", display: "grid", gap: 16 }}>
        <header style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "end" }}>
          <div>
            <p style={{ margin: 0, fontSize: 12, letterSpacing: "0.08em", color: "var(--muted)" }}>PAYOUTS</p>
            <h1 style={{ margin: "6px 0 8px", fontSize: 30, color: "var(--text)" }}>支払い管理</h1>
            <p style={{ margin: 0, color: "var(--muted)" }}>
              外注請求の承認、支払予定化、銀行CSV、PDF ZIP をまとめて管理します。
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/vendors" style={linkButtonStyle}>
              Vendors を開く
            </Link>
            <select value={month} onChange={(event) => setMonth(event.target.value)} style={inputStyle}>
              {monthOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </header>

        <section style={{ ...cardStyle, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
          <SummaryCard label="対象件数" value={String(filteredRows.length)} />
          <SummaryCard label="選択件数" value={String(selectedRows.length)} />
          <SummaryCard label="選択合計" value={formatCurrency(selectedTotal)} />
          <SummaryCard label="支払済み" value={String(filteredRows.filter((row) => row.status === "paid").length)} />
        </section>

        <section style={{ ...cardStyle, display: "grid", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 700, color: "var(--text)" }}>一括操作</div>
              <div style={{ marginTop: 4, fontSize: 13, color: "var(--muted)" }}>
                {selectedRows.length}件選択中。承認すると payout が自動作成され、支払済みにすると payout も更新されます。
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={toggleSelectAll} style={secondaryButtonStyle}>
                {selectedRows.length === filteredRows.length && filteredRows.length > 0 ? "全解除" : "表示中をすべて選択"}
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
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12, color: "var(--muted)" }}>
            <span>未確認: まだ会社側の支払い判断前</span>
            <span>提出済み: 外注から提出済み</span>
            <span>承認済み: payout 追加済み / 支払予定に載せる状態</span>
            <span>支払済み: 実振込後の状態</span>
          </div>
        </section>

        {error ? <section style={{ ...cardStyle, borderColor: "#fecaca", background: "#fff1f2", color: "#b91c1c" }}>{error}</section> : null}
        {success ? <section style={{ ...cardStyle, borderColor: "#bbf7d0", background: "#f0fdf4", color: "#166534" }}>{success}</section> : null}

        <section style={{ ...cardStyle, display: "grid", gap: 14 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>銀行CSV設定</h2>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)" }}>
              組織単位で委託者コードと口座名義カナを保持します。出力は UTF-8 BOM / CRLF です。
            </p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
            <select
              value={csvSettings.payout_csv_format}
              onChange={(event) =>
                setCsvSettings((prev) => ({
                  ...prev,
                  payout_csv_format: event.target.value as "zengin_simple" | "custom_basic",
                }))
              }
              style={inputStyle}
            >
              <option value="zengin_simple">全銀CSV（簡易）</option>
              <option value="custom_basic">汎用CSV</option>
            </select>
            <input
              value={csvSettings.payout_csv_depositor_code}
              onChange={(event) =>
                setCsvSettings((prev) => ({ ...prev, payout_csv_depositor_code: event.target.value }))
              }
              placeholder="委託者コード"
              style={inputStyle}
            />
            <input
              value={csvSettings.payout_csv_company_name_kana}
              onChange={(event) =>
                setCsvSettings((prev) => ({ ...prev, payout_csv_company_name_kana: event.target.value }))
              }
              placeholder="会社名カナ"
              style={inputStyle}
            />
          </div>
          <textarea
            value={csvSettings.payout_csv_notes}
            onChange={(event) =>
              setCsvSettings((prev) => ({ ...prev, payout_csv_notes: event.target.value }))
            }
            rows={3}
            placeholder="取込前の注意点をメモできます。"
            style={{ ...inputStyle, resize: "vertical" }}
          />
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
                出力対象を確認してから CSV をダウンロードしてください。
              </p>
            </div>
            <button type="button" disabled={csvPreview.length === 0 || busyKey !== null} onClick={() => void exportCsv()} style={primaryButtonStyle}>
              CSV を出力
            </button>
          </div>

          {csvPreview.length === 0 ? (
            <div style={{ color: "var(--muted)" }}>選択した外注請求でプレビューを作成してください。</div>
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
                    <span>口座: {row.accountType || "-"} / {row.accountNumber || "-"}</span>
                    <span>名義カナ: {row.accountHolderKana || "-"}</span>
                  </div>
                  {row.warning ? <div style={{ marginTop: 6, color: "#b45309", fontSize: 13 }}>{row.warning}</div> : null}
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
              どの月を何件出力したかを確認できます。
            </p>
          </div>
          {csvHistory.length === 0 ? (
            <div style={{ color: "var(--muted)" }}>CSV出力履歴はまだありません。</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {csvHistory.map((history) => (
                <div key={history.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
                  <div>
                    <div style={{ fontWeight: 700, color: "var(--text)" }}>{history.file_name}</div>
                    <div style={{ marginTop: 4, fontSize: 13, color: "var(--muted)" }}>
                      {history.export_month} / {history.line_count}件 / {history.encoding}
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
          {filteredRows.map((row) => {
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
                      <strong style={{ color: "var(--text)" }}>{vendor?.name ?? "外注先未設定"}</strong>
                      <span style={{ ...badgeBase, background: status.bg, color: status.text }}>{status.label}</span>
                      {bankMissing ? <span style={{ ...badgeBase, background: "#fff7ed", color: "#9a3412" }}>口座不足</span> : null}
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
          })}
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
