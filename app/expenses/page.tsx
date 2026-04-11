"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { FinanceOpsShell } from "@/components/finance/FinanceOpsShell"
import { ProjectInfoCard, ProjectSection } from "@/components/project/ProjectShell"
import {
  buttonPrimaryStyle,
  formatCurrency,
  inputStyle,
  tableStyle,
  tdStyle,
  textOrDash,
  textareaStyle,
  thStyle,
} from "@/components/project/projectPageStyles"
import { useProjectWorkspace } from "@/hooks/useProjectWorkspace"
import { supabase } from "@/lib/supabase"

type ReceiptFilter = "all" | "missing" | "ready"
type LinkFilter = "all" | "unlinked" | "linked"

const CATEGORY_OPTIONS = [
  { value: "transport", label: "交通費" },
  { value: "location", label: "ロケ費" },
  { value: "material", label: "素材購入" },
  { value: "purchase", label: "代理購入" },
  { value: "tool", label: "案件ツール" },
  { value: "other", label: "その他" },
] as const

async function getAccessToken() {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

export default function ExpensesPage() {
  const {
    loading,
    error,
    canViewFinance,
    orgId,
    month,
    projects,
    contents,
    expenses,
    refresh,
  } = useProjectWorkspace({ requireAdminSurface: true })
  const [selectedMonth, setSelectedMonth] = useState(month)
  const [search, setSearch] = useState("")
  const [receiptFilter, setReceiptFilter] = useState<ReceiptFilter>("all")
  const [linkFilter, setLinkFilter] = useState<LinkFilter>("all")
  const [busy, setBusy] = useState(false)
  const [uiError, setUiError] = useState<string | null>(null)
  const [uiSuccess, setUiSuccess] = useState<string | null>(null)
  const [form, setForm] = useState({
    projectId: "",
    contentId: "",
    category: "transport",
    description: "",
    amount: "",
    occurredOn: `${month}-01`,
    targetMonth: month,
    payeeName: "",
    receiptPath: "",
  })

  const monthOptions = useMemo(() => {
    const values = new Set<string>([month])
    expenses.forEach((row) => values.add(row.occurred_on.slice(0, 7)))
    return [...values].sort().reverse()
  }, [expenses, month])

  const projectNameById = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects])
  const contentTitleById = useMemo(() => new Map(contents.map((content) => [content.id, content.title])), [contents])
  const projectContents = useMemo(
    () => contents.filter((content) => content.project_id === form.projectId),
    [contents, form.projectId]
  )

  const monthExpenses = useMemo(
    () => expenses.filter((row) => row.occurred_on.startsWith(selectedMonth)),
    [expenses, selectedMonth]
  )
  const filteredExpenses = useMemo(() => {
    const query = search.trim().toLowerCase()
    return monthExpenses.filter((row) => {
      const hasReceipt = Boolean(String(row.receipt_path ?? "").trim())
      const isLinked = Boolean(row.project_id || row.content_id)
      const matchesReceipt = receiptFilter === "all" || (receiptFilter === "missing" ? !hasReceipt : hasReceipt)
      const matchesLink = linkFilter === "all" || (linkFilter === "linked" ? isLinked : !isLinked)
      const haystack = [
        row.category,
        row.description,
        projectNameById.get(row.project_id ?? ""),
        contentTitleById.get(row.content_id ?? ""),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return matchesReceipt && matchesLink && (!query || haystack.includes(query))
    })
  }, [contentTitleById, linkFilter, monthExpenses, projectNameById, receiptFilter, search])

  const monthTotal = useMemo(
    () => monthExpenses.reduce((sum, row) => sum + Number(row.amount ?? 0), 0),
    [monthExpenses]
  )
  const missingReceiptCount = useMemo(
    () => monthExpenses.filter((row) => !String(row.receipt_path ?? "").trim()).length,
    [monthExpenses]
  )
  const unlinkedCount = useMemo(
    () => monthExpenses.filter((row) => !row.project_id && !row.content_id).length,
    [monthExpenses]
  )

  const createExpense = async () => {
    if (!canViewFinance || !orgId) return
    if (!form.description.trim() || !form.amount || !form.occurredOn) {
      setUiError("摘要、金額、発生日を入力してください。")
      return
    }

    setBusy(true)
    setUiError(null)
    setUiSuccess(null)
    const token = await getAccessToken()
    if (!token) {
      setBusy(false)
      setUiError("ログイン状態を確認できませんでした。")
      return
    }
    const res = await fetch("/api/expenses/create", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        orgId,
        projectId: form.projectId || null,
        contentId: form.contentId || null,
        category: form.category,
        description: form.description.trim(),
        amount: Number(form.amount),
        occurredOn: form.occurredOn,
        targetMonth: form.targetMonth || form.occurredOn.slice(0, 7),
        payeeName: form.payeeName.trim() || null,
        receiptPath: form.receiptPath.trim() || null,
        receiptCollectionStatus: form.receiptPath.trim() ? "received" : "requested",
      }),
    })
    const json = await res.json().catch(() => null)
    setBusy(false)

    if (!res.ok || !json?.ok) {
      setUiError(`経費の登録に失敗しました: ${json?.error ?? "unknown error"}`)
      return
    }

    setUiSuccess("経費を登録しました。")
    setForm((prev) => ({
      ...prev,
      contentId: "",
      description: "",
      amount: "",
      payeeName: "",
      receiptPath: "",
    }))
    await refresh()
  }

  const runExpenseAction = async (expenseId: string, path: string, body: Record<string, unknown> = {}) => {
    if (!orgId) return
    const token = await getAccessToken()
    if (!token) {
      setUiError("ログイン状態を確認できませんでした。")
      return
    }
    setBusy(true)
    setUiError(null)
    setUiSuccess(null)
    const res = await fetch(path, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ orgId, expenseId, ...body }),
    })
    const json = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok || !json?.ok) {
      setUiError(json?.error ?? "経費操作に失敗しました。")
      return
    }
    setUiSuccess("経費を更新しました。")
    await refresh()
  }

  if (loading) {
    return <FinanceOpsShell title="経費管理" description="案件直結経費と証憑状態を管理します。">読み込み中...</FinanceOpsShell>
  }

  if (!canViewFinance) {
    return (
      <FinanceOpsShell title="経費管理" description="案件直結経費と証憑状態を管理します。">
        <ProjectSection title="権限不足">この画面は owner / executive_assistant のみ利用できます。</ProjectSection>
      </FinanceOpsShell>
    )
  }

  return (
    <FinanceOpsShell
      title="経費管理"
      description="案件直結経費だけを登録し、証憑不足と未紐付けを締め前に解消します。"
      action={
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/close" style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", textDecoration: "none", color: "var(--text)" }}>
            締めに戻る
          </Link>
          <Link href="/profitability" style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", textDecoration: "none", color: "var(--text)" }}>
            粗利を見る
          </Link>
        </div>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <ProjectInfoCard label="対象月" value={selectedMonth} />
        <ProjectInfoCard label="件数" value={`${monthExpenses.length}件`} />
        <ProjectInfoCard label="合計" value={formatCurrency(monthTotal)} />
        <ProjectInfoCard label="証憑待ち" value={`${missingReceiptCount}件`} accent={missingReceiptCount > 0 ? "var(--warning-text)" : undefined} />
        <ProjectInfoCard label="未紐付け" value={`${unlinkedCount}件`} accent={unlinkedCount > 0 ? "var(--warning-text)" : undefined} />
      </div>

      {(error || uiError || uiSuccess) && (
        <ProjectSection title="メッセージ">
          {error ? <div style={{ color: "var(--error-text)" }}>{error}</div> : null}
          {uiError ? <div style={{ color: "var(--error-text)" }}>{uiError}</div> : null}
          {uiSuccess ? <div style={{ color: "var(--success-text)" }}>{uiSuccess}</div> : null}
        </ProjectSection>
      )}

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 0.95fr) minmax(0, 1.05fr)" }}>
        <ProjectSection title="経費登録" description="receipt_path は証憑ファイルや管理先パスの控えとして使います。">
          <div style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span>案件</span>
              <select
                value={form.projectId}
                onChange={(event) => setForm((prev) => ({ ...prev, projectId: event.target.value, contentId: "" }))}
                style={inputStyle}
              >
                <option value="">未設定</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span>コンテンツ</span>
              <select
                value={form.contentId}
                onChange={(event) => setForm((prev) => ({ ...prev, contentId: event.target.value }))}
                style={inputStyle}
                disabled={!form.projectId}
              >
                <option value="">未設定</option>
                {projectContents.map((content) => (
                  <option key={content.id} value={content.id}>
                    {content.title}
                  </option>
                ))}
              </select>
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span>カテゴリ</span>
                <select value={form.category} onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))} style={inputStyle}>
                  {CATEGORY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>金額</span>
                <input value={form.amount} onChange={(event) => setForm((prev) => ({ ...prev, amount: event.target.value }))} inputMode="numeric" style={inputStyle} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>発生日</span>
                <input type="date" value={form.occurredOn} onChange={(event) => setForm((prev) => ({ ...prev, occurredOn: event.target.value }))} style={inputStyle} />
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span>対象月</span>
                <input value={form.targetMonth} onChange={(event) => setForm((prev) => ({ ...prev, targetMonth: event.target.value }))} style={inputStyle} placeholder="YYYY-MM" />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>支払先</span>
                <input value={form.payeeName} onChange={(event) => setForm((prev) => ({ ...prev, payeeName: event.target.value }))} style={inputStyle} placeholder="店舗名 / 取引先名" />
              </label>
            </div>

            <label style={{ display: "grid", gap: 6 }}>
              <span>摘要</span>
              <textarea value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} style={textareaStyle} />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span>receipt_path</span>
              <input value={form.receiptPath} onChange={(event) => setForm((prev) => ({ ...prev, receiptPath: event.target.value }))} style={inputStyle} placeholder="storage path / URL / 管理メモ" />
            </label>

            <button type="button" onClick={() => void createExpense()} disabled={busy} style={buttonPrimaryStyle}>
              {busy ? "登録中..." : "経費を登録する"}
            </button>
          </div>
        </ProjectSection>

        <ProjectSection title="絞り込み" description="締め対象月の証憑不足や未紐付けを素早く洗い出します。">
          <div style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span>対象月</span>
              <select value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} style={inputStyle}>
                {monthOptions.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>検索</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} style={inputStyle} placeholder="摘要、案件、コンテンツで検索" />
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span>証憑</span>
                <select value={receiptFilter} onChange={(event) => setReceiptFilter(event.target.value as ReceiptFilter)} style={inputStyle}>
                  <option value="all">すべて</option>
                  <option value="missing">証憑待ち</option>
                  <option value="ready">証憑あり</option>
                </select>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>紐付け</span>
                <select value={linkFilter} onChange={(event) => setLinkFilter(event.target.value as LinkFilter)} style={inputStyle}>
                  <option value="all">すべて</option>
                  <option value="unlinked">未紐付け</option>
                  <option value="linked">紐付け済み</option>
                </select>
              </label>
            </div>
          </div>
        </ProjectSection>
      </div>

      <ProjectSection title="経費一覧" description="receipt_path が空の行は締め前に補完してください。">
        <div style={{ overflowX: "auto" }}>
          <table style={{ ...tableStyle, minWidth: 1120 }}>
            <thead>
              <tr>
                <th style={thStyle}>発生日</th>
                <th style={thStyle}>カテゴリ</th>
                <th style={thStyle}>摘要</th>
                <th style={thStyle}>案件</th>
                <th style={thStyle}>コンテンツ</th>
                <th style={thStyle}>金額</th>
                <th style={thStyle}>証憑</th>
                <th style={thStyle}>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredExpenses.map((row) => (
                <tr key={row.id}>
                  <td style={tdStyle}>{row.occurred_on}</td>
                  <td style={tdStyle}>{row.category}</td>
                  <td style={tdStyle}>{row.description}</td>
                  <td style={tdStyle}>{textOrDash(projectNameById.get(row.project_id ?? ""))}</td>
                  <td style={tdStyle}>{textOrDash(contentTitleById.get(row.content_id ?? ""))}</td>
                  <td style={tdStyle}>{formatCurrency(row.amount)}</td>
                  <td style={tdStyle}>
                    {String(row.receipt_path ?? "").trim() ? (
                      <code style={{ fontSize: 12 }}>{row.receipt_path}</code>
                    ) : (
                      <span style={{ color: "var(--warning-text)", fontWeight: 700 }}>未登録</span>
                    )}
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button type="button" disabled={busy} onClick={() => void runExpenseAction(row.id, "/api/expenses/parse")} style={{ ...buttonPrimaryStyle, padding: "6px 8px" }}>
                        解析
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void runExpenseAction(row.id, "/api/expenses/request-receipt", { requestedToType: "internal" })}
                        style={{ ...buttonPrimaryStyle, padding: "6px 8px", background: "var(--surface-2)", color: "var(--text)", borderColor: "var(--border)" }}
                      >
                        証憑依頼
                      </button>
                      {(form.projectId || form.contentId) ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void runExpenseAction(row.id, "/api/expenses/link", { projectId: form.projectId || null, contentId: form.contentId || null })}
                          style={{ ...buttonPrimaryStyle, padding: "6px 8px", background: "var(--surface-2)", color: "var(--text)", borderColor: "var(--border)" }}
                        >
                          選択案件へ紐付け
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredExpenses.length === 0 ? (
                <tr>
                  <td style={tdStyle} colSpan={8}>条件に合う経費はありません。</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </ProjectSection>
    </FinanceOpsShell>
  )
}
