"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { ProjectInfoCard, ProjectSection, ProjectShell } from "@/components/project/ProjectShell"
import {
  buttonPrimaryStyle,
  formatCurrency,
  inputStyle,
  tableStyle,
  tdStyle,
  textareaStyle,
  thStyle,
} from "@/components/project/projectPageStyles"
import { useProjectWorkspace } from "@/hooks/useProjectWorkspace"
import { supabase } from "@/lib/supabase"

function formatPercent(value: number | null) {
  return value == null ? "-" : `${Math.round(value * 100)}%`
}

function safeNumber(value: unknown) {
  const num = Number(value ?? 0)
  return Number.isFinite(num) ? num : 0
}

export default function FinanceLitePage() {
  const searchParams = useSearchParams()
  const initialProjectId = searchParams.get("projectId") ?? ""
  const {
    loading,
    error,
    canViewFinance,
    orgId,
    month,
    clients,
    projects,
    contents,
    expenses,
    rateCards,
    invoices,
    invoiceLines,
    vendorInvoices,
    vendorInvoiceLines,
    projectSummaries,
    refresh,
  } = useProjectWorkspace()

  const [projectFilter, setProjectFilter] = useState(initialProjectId)
  const [expenseBusy, setExpenseBusy] = useState(false)
  const [rateBusy, setRateBusy] = useState(false)
  const [uiError, setUiError] = useState<string | null>(null)
  const [uiSuccess, setUiSuccess] = useState<string | null>(null)
  const [expenseForm, setExpenseForm] = useState({
    projectId: initialProjectId,
    contentId: "",
    category: "other",
    description: "",
    amount: "",
    occurredOn: `${month}-01`,
  })
  const [rateForm, setRateForm] = useState({
    projectId: initialProjectId,
    clientId: "",
    itemType: "video",
    unitLabel: "本",
    salesUnitPrice: "",
    standardCost: "",
    effectiveFrom: `${month}-01`,
    effectiveTo: "",
  })

  const projectNameById = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects])

  const filteredSummaries = useMemo(
    () => projectSummaries.filter((summary) => !projectFilter || summary.project.id === projectFilter),
    [projectFilter, projectSummaries]
  )

  const filteredExpenses = useMemo(
    () => expenses.filter((expense) => !projectFilter || expense.project_id === projectFilter),
    [expenses, projectFilter]
  )

  const filteredRateCards = useMemo(
    () =>
      rateCards.filter((rateCard) => {
        if (!projectFilter) return true
        return rateCard.project_id === projectFilter
      }),
    [projectFilter, rateCards]
  )

  const filteredContents = useMemo(
    () => contents.filter((content) => !projectFilter || content.project_id === projectFilter),
    [contents, projectFilter]
  )

  const projectContents = useMemo(
    () => contents.filter((content) => content.project_id === expenseForm.projectId),
    [contents, expenseForm.projectId]
  )

  const contentSalesById = useMemo(() => {
    const validInvoiceIds = new Set(invoices.filter((invoice) => invoice.status !== "void").map((invoice) => invoice.id))
    const map = new Map<string, number>()
    for (const line of invoiceLines) {
      if (!line.content_id || !validInvoiceIds.has(line.invoice_id)) continue
      map.set(line.content_id, (map.get(line.content_id) ?? 0) + safeNumber(line.amount))
    }
    return map
  }, [invoiceLines, invoices])

  const contentCostById = useMemo(() => {
    const validVendorInvoiceIds = new Set(vendorInvoices.filter((invoice) => invoice.status !== "void").map((invoice) => invoice.id))
    const map = new Map<string, number>()
    for (const line of vendorInvoiceLines) {
      if (!line.content_id || !validVendorInvoiceIds.has(line.vendor_invoice_id)) continue
      map.set(line.content_id, (map.get(line.content_id) ?? 0) + safeNumber(line.amount))
    }
    return map
  }, [vendorInvoiceLines, vendorInvoices])

  const totals = useMemo(
    () =>
      filteredSummaries.reduce(
        (acc, summary) => {
          acc.sales += summary.monthlySales
          acc.vendorCost += summary.monthlyVendorCost
          acc.expense += summary.monthlyExpenses
          acc.gross += summary.grossProfit
          return acc
        },
        { sales: 0, vendorCost: 0, expense: 0, gross: 0 }
      ),
    [filteredSummaries]
  )

  const lowMarginProjects = useMemo(
    () =>
      filteredSummaries
        .filter((summary) => summary.grossProfit < 0 || (summary.marginRate ?? 1) < 0.35)
        .sort((a, b) => (a.marginRate ?? -1) - (b.marginRate ?? -1)),
    [filteredSummaries]
  )

  const revisionHeavyContents = useMemo(
    () =>
      filteredContents
        .filter((content) => Number(content.revision_count ?? 0) >= 3)
        .sort((a, b) => Number(b.revision_count ?? 0) - Number(a.revision_count ?? 0)),
    [filteredContents]
  )

  const costOverContents = useMemo(
    () =>
      filteredContents
        .filter((content) => {
          const sales = contentSalesById.get(content.id) ?? safeNumber(content.unit_price)
          const cost = contentCostById.get(content.id) ?? safeNumber(content.estimated_cost)
          return sales > 0 && cost > sales
        })
        .sort((a, b) => {
          const aCost = contentCostById.get(a.id) ?? safeNumber(a.estimated_cost)
          const bCost = contentCostById.get(b.id) ?? safeNumber(b.estimated_cost)
          return bCost - aCost
        }),
    [contentCostById, contentSalesById, filteredContents]
  )

  const contentProfitability = useMemo(
    () =>
      filteredContents
        .map((content) => {
          const sales = contentSalesById.get(content.id) ?? safeNumber(content.unit_price)
          const cost = contentCostById.get(content.id) ?? safeNumber(content.estimated_cost)
          const gross = sales - cost
          return {
            ...content,
            sales,
            cost,
            gross,
            marginRate: sales > 0 ? gross / sales : null,
          }
        })
        .sort((a, b) => (a.marginRate ?? -1) - (b.marginRate ?? -1)),
    [contentCostById, contentSalesById, filteredContents]
  )

  const monthlyTrend = useMemo(() => {
    const monthMap = new Map<string, { sales: number; vendorCost: number; expense: number }>()

    for (const content of filteredContents) {
      const targetMonth = content.delivery_month || content.due_client_at.slice(0, 7)
      const current = monthMap.get(targetMonth) ?? { sales: 0, vendorCost: 0, expense: 0 }
      current.sales += contentSalesById.get(content.id) ?? safeNumber(content.unit_price)
      current.vendorCost += contentCostById.get(content.id) ?? safeNumber(content.estimated_cost)
      monthMap.set(targetMonth, current)
    }

    for (const expense of filteredExpenses) {
      const targetMonth = expense.occurred_on.slice(0, 7)
      const current = monthMap.get(targetMonth) ?? { sales: 0, vendorCost: 0, expense: 0 }
      current.expense += safeNumber(expense.amount)
      monthMap.set(targetMonth, current)
    }

    return Array.from(monthMap.entries())
      .map(([targetMonth, values]) => ({
        month: targetMonth,
        sales: values.sales,
        vendorCost: values.vendorCost,
        expense: values.expense,
        gross: values.sales - values.vendorCost - values.expense,
      }))
      .sort((a, b) => b.month.localeCompare(a.month))
  }, [contentCostById, contentSalesById, filteredContents, filteredExpenses])

  const createExpense = async () => {
    if (!canViewFinance || !orgId) return
    if (!expenseForm.description.trim() || !expenseForm.amount || !expenseForm.occurredOn) {
      setUiError("費目、金額、発生日を入力してください。")
      return
    }

    setExpenseBusy(true)
    setUiError(null)
    setUiSuccess(null)
    const { error: insertError } = await supabase.from("expenses").insert({
      id: crypto.randomUUID(),
      org_id: orgId,
      project_id: expenseForm.projectId || null,
      content_id: expenseForm.contentId || null,
      category: expenseForm.category.trim() || "other",
      description: expenseForm.description.trim(),
      amount: Number(expenseForm.amount),
      occurred_on: expenseForm.occurredOn,
    })
    setExpenseBusy(false)

    if (insertError) {
      setUiError(`経費の登録に失敗しました: ${insertError.message}`)
      return
    }

    setUiSuccess("経費を登録しました。")
    setExpenseForm((prev) => ({
      ...prev,
      contentId: "",
      description: "",
      amount: "",
    }))
    await refresh()
  }

  const createRateCard = async () => {
    if (!canViewFinance || !orgId) return
    if (!rateForm.itemType.trim() || !rateForm.salesUnitPrice || !rateForm.standardCost || !rateForm.effectiveFrom) {
      setUiError("単価項目、売上単価、原価、開始日を入力してください。")
      return
    }

    setRateBusy(true)
    setUiError(null)
    setUiSuccess(null)
    const project = projects.find((row) => row.id === rateForm.projectId)
    const { error: insertError } = await supabase.from("rate_cards").insert({
      id: crypto.randomUUID(),
      org_id: orgId,
      project_id: rateForm.projectId || null,
      client_id: rateForm.clientId || project?.client_id || null,
      item_type: rateForm.itemType.trim(),
      unit_label: rateForm.unitLabel.trim() || "本",
      sales_unit_price: Number(rateForm.salesUnitPrice),
      standard_cost: Number(rateForm.standardCost),
      effective_from: rateForm.effectiveFrom,
      effective_to: rateForm.effectiveTo || null,
    })
    setRateBusy(false)

    if (insertError) {
      setUiError(`単価ルールの登録に失敗しました: ${insertError.message}`)
      return
    }

    setUiSuccess("単価ルールを登録しました。")
    setRateForm((prev) => ({
      ...prev,
      itemType: "video",
      unitLabel: "本",
      salesUnitPrice: "",
      standardCost: "",
      effectiveTo: "",
    }))
    await refresh()
  }

  if (!canViewFinance) {
    return (
      <ProjectShell title="収支管理" description="収支画面は owner / executive_assistant のみ利用できます。">
        <ProjectSection title="権限不足">この画面は owner / executive_assistant のみ利用できます。</ProjectSection>
      </ProjectShell>
    )
  }

  return (
    <ProjectShell title="収支管理" description="案件別の売上、外注原価、経費、利益率を横断確認します。">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <ProjectInfoCard label="対象月" value={month} />
        <ProjectInfoCard label="売上" value={formatCurrency(totals.sales)} />
        <ProjectInfoCard label="外注原価" value={formatCurrency(totals.vendorCost)} />
        <ProjectInfoCard label="経費" value={formatCurrency(totals.expense)} />
        <ProjectInfoCard label="粗利" value={formatCurrency(totals.gross)} accent={totals.gross < 0 ? "var(--error-text)" : undefined} />
        <ProjectInfoCard label="低粗利案件" value={`${lowMarginProjects.length}件`} accent={lowMarginProjects.length > 0 ? "var(--warning-text)" : undefined} />
        <ProjectInfoCard label="修正過多" value={`${revisionHeavyContents.length}本`} accent={revisionHeavyContents.length > 0 ? "var(--warning-text)" : undefined} />
        <ProjectInfoCard label="原価超過" value={`${costOverContents.length}本`} accent={costOverContents.length > 0 ? "var(--error-text)" : undefined} />
      </div>

      <ProjectSection title="絞り込み" description="案件単位で収支を確認できます。">
        <label style={{ display: "grid", gap: 6, maxWidth: 320 }}>
          <span>案件</span>
          <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} style={inputStyle}>
            <option value="">すべて</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      </ProjectSection>

      {(uiError || uiSuccess) ? (
        <ProjectSection title="通知">
          {uiError ? <div style={{ color: "var(--error-text)" }}>{uiError}</div> : null}
          {uiSuccess ? <div style={{ color: "var(--success-text)" }}>{uiSuccess}</div> : null}
        </ProjectSection>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
        <ProjectSection title="低粗利案件" description="粗利が赤字、または粗利率 35% 未満の案件です。">
          <div style={{ overflowX: "auto" }}>
            <table style={{ ...tableStyle, minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={thStyle}>案件</th>
                  <th style={thStyle}>売上</th>
                  <th style={thStyle}>外注原価</th>
                  <th style={thStyle}>経費</th>
                  <th style={thStyle}>粗利</th>
                  <th style={thStyle}>粗利率</th>
                </tr>
              </thead>
              <tbody>
                {lowMarginProjects.slice(0, 12).map((summary) => (
                  <tr key={summary.project.id}>
                    <td style={tdStyle}>
                      <Link href={`/projects/${summary.project.id}`} style={{ color: "var(--primary)", textDecoration: "none", fontWeight: 700 }}>
                        {summary.project.name}
                      </Link>
                    </td>
                    <td style={tdStyle}>{formatCurrency(summary.monthlySales)}</td>
                    <td style={tdStyle}>{formatCurrency(summary.monthlyVendorCost)}</td>
                    <td style={tdStyle}>{formatCurrency(summary.monthlyExpenses)}</td>
                    <td style={{ ...tdStyle, color: summary.grossProfit < 0 ? "var(--error-text)" : tdStyle.color }}>{formatCurrency(summary.grossProfit)}</td>
                    <td style={{ ...tdStyle, color: (summary.marginRate ?? 1) < 0.35 ? "var(--warning-text)" : tdStyle.color }}>{formatPercent(summary.marginRate)}</td>
                  </tr>
                ))}
                {lowMarginProjects.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={tdStyle}>該当案件はありません。</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </ProjectSection>

        <ProjectSection title="修正過多 / 原価超過" description="早めに対応したいコンテンツを抽出します。">
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>修正過多コンテンツ</div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ ...tableStyle, minWidth: 520 }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>案件</th>
                      <th style={thStyle}>コンテンツ</th>
                      <th style={thStyle}>修正回数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {revisionHeavyContents.slice(0, 8).map((content) => (
                      <tr key={content.id}>
                        <td style={tdStyle}>{projectNameById.get(content.project_id ?? "") ?? "-"}</td>
                        <td style={tdStyle}>{content.title}</td>
                        <td style={tdStyle}>{Number(content.revision_count ?? 0)}回</td>
                      </tr>
                    ))}
                    {revisionHeavyContents.length === 0 ? (
                      <tr>
                        <td colSpan={3} style={tdStyle}>該当コンテンツはありません。</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>原価超過コンテンツ</div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ ...tableStyle, minWidth: 620 }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>案件</th>
                      <th style={thStyle}>コンテンツ</th>
                      <th style={thStyle}>売上</th>
                      <th style={thStyle}>想定原価</th>
                    </tr>
                  </thead>
                  <tbody>
                    {costOverContents.slice(0, 8).map((content) => (
                      <tr key={content.id}>
                        <td style={tdStyle}>{projectNameById.get(content.project_id ?? "") ?? "-"}</td>
                        <td style={tdStyle}>{content.title}</td>
                        <td style={tdStyle}>{formatCurrency(Number(content.unit_price ?? 0))}</td>
                        <td style={{ ...tdStyle, color: "var(--error-text)" }}>{formatCurrency(Number(content.estimated_cost ?? 0))}</td>
                      </tr>
                    ))}
                    {costOverContents.length === 0 ? (
                      <tr>
                        <td colSpan={4} style={tdStyle}>該当コンテンツはありません。</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </ProjectSection>
      </div>

      <ProjectSection title="案件別収支" description="既存の請求・外注データがあればそれを優先し、なければ contents の単価 / 想定原価を使います。">
        {loading ? <div>読み込み中...</div> : null}
        {error ? <div style={{ color: "var(--error-text)" }}>{error}</div> : null}
        {!loading ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ ...tableStyle, minWidth: 1200 }}>
              <thead>
                <tr>
                  <th style={thStyle}>案件</th>
                  <th style={thStyle}>本数</th>
                  <th style={thStyle}>売上</th>
                  <th style={thStyle}>外注原価</th>
                  <th style={thStyle}>経費</th>
                  <th style={thStyle}>粗利</th>
                  <th style={thStyle}>粗利率</th>
                  <th style={thStyle}>例外</th>
                </tr>
              </thead>
              <tbody>
                {filteredSummaries.map((summary) => (
                  <tr key={summary.project.id}>
                    <td style={tdStyle}>
                      <Link href={`/projects/${summary.project.id}`} style={{ color: "var(--primary)", textDecoration: "none", fontWeight: 700 }}>
                        {summary.project.name}
                      </Link>
                    </td>
                    <td style={tdStyle}>{summary.monthlyContentCount}</td>
                    <td style={tdStyle}>{formatCurrency(summary.monthlySales)}</td>
                    <td style={tdStyle}>{formatCurrency(summary.monthlyVendorCost)}</td>
                    <td style={tdStyle}>{formatCurrency(summary.monthlyExpenses)}</td>
                    <td style={{ ...tdStyle, color: summary.grossProfit < 0 ? "var(--error-text)" : tdStyle.color }}>{formatCurrency(summary.grossProfit)}</td>
                    <td style={{ ...tdStyle, color: (summary.marginRate ?? 1) < 0.35 ? "var(--warning-text)" : tdStyle.color }}>{formatPercent(summary.marginRate)}</td>
                    <td style={tdStyle}>{summary.openExceptionCount}</td>
                  </tr>
                ))}
                {filteredSummaries.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={tdStyle}>対象案件はありません。</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </ProjectSection>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
        <ProjectSection title="月次推移">
          <div style={{ overflowX: "auto" }}>
            <table style={{ ...tableStyle, minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={thStyle}>月</th>
                  <th style={thStyle}>売上</th>
                  <th style={thStyle}>外注原価</th>
                  <th style={thStyle}>経費</th>
                  <th style={thStyle}>粗利</th>
                </tr>
              </thead>
              <tbody>
                {monthlyTrend.map((row) => (
                  <tr key={row.month}>
                    <td style={tdStyle}>{row.month}</td>
                    <td style={tdStyle}>{formatCurrency(row.sales)}</td>
                    <td style={tdStyle}>{formatCurrency(row.vendorCost)}</td>
                    <td style={tdStyle}>{formatCurrency(row.expense)}</td>
                    <td style={{ ...tdStyle, color: row.gross < 0 ? "var(--error-text)" : tdStyle.color }}>{formatCurrency(row.gross)}</td>
                  </tr>
                ))}
                {monthlyTrend.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={tdStyle}>月次データはありません。</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </ProjectSection>

        <ProjectSection title="コンテンツ別収支">
          <div style={{ overflowX: "auto" }}>
            <table style={{ ...tableStyle, minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={thStyle}>案件</th>
                  <th style={thStyle}>コンテンツ</th>
                  <th style={thStyle}>売上</th>
                  <th style={thStyle}>想定原価</th>
                  <th style={thStyle}>粗利</th>
                  <th style={thStyle}>粗利率</th>
                </tr>
              </thead>
              <tbody>
                {contentProfitability.slice(0, 20).map((content) => (
                  <tr key={content.id}>
                    <td style={tdStyle}>{projectNameById.get(content.project_id ?? "") ?? "-"}</td>
                    <td style={tdStyle}>{content.title}</td>
                    <td style={tdStyle}>{formatCurrency(content.sales)}</td>
                    <td style={tdStyle}>{formatCurrency(content.cost)}</td>
                    <td style={{ ...tdStyle, color: content.gross < 0 ? "var(--error-text)" : tdStyle.color }}>{formatCurrency(content.gross)}</td>
                    <td style={{ ...tdStyle, color: (content.marginRate ?? 1) < 0.35 ? "var(--warning-text)" : tdStyle.color }}>{formatPercent(content.marginRate)}</td>
                  </tr>
                ))}
                {contentProfitability.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={tdStyle}>コンテンツ別収支はありません。</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </ProjectSection>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
        <ProjectSection title="経費登録">
          <div style={{ display: "grid", gap: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span>案件</span>
              <select value={expenseForm.projectId} onChange={(event) => setExpenseForm((prev) => ({ ...prev, projectId: event.target.value, contentId: "" }))} style={inputStyle}>
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
              <select value={expenseForm.contentId} onChange={(event) => setExpenseForm((prev) => ({ ...prev, contentId: event.target.value }))} style={inputStyle}>
                <option value="">未設定</option>
                {projectContents.map((content) => (
                  <option key={content.id} value={content.id}>
                    {content.title}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>カテゴリ</span>
              <input value={expenseForm.category} onChange={(event) => setExpenseForm((prev) => ({ ...prev, category: event.target.value }))} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>発生日</span>
              <input type="date" value={expenseForm.occurredOn} onChange={(event) => setExpenseForm((prev) => ({ ...prev, occurredOn: event.target.value }))} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>金額</span>
              <input type="number" min="0" value={expenseForm.amount} onChange={(event) => setExpenseForm((prev) => ({ ...prev, amount: event.target.value }))} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>内容</span>
              <textarea value={expenseForm.description} onChange={(event) => setExpenseForm((prev) => ({ ...prev, description: event.target.value }))} style={textareaStyle} />
            </label>
            <button type="button" onClick={() => void createExpense()} disabled={expenseBusy} style={buttonPrimaryStyle}>
              {expenseBusy ? "登録中..." : "経費を登録"}
            </button>
          </div>
        </ProjectSection>

        <ProjectSection title="単価ルール登録">
          <div style={{ display: "grid", gap: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span>案件</span>
              <select
                value={rateForm.projectId}
                onChange={(event) => {
                  const projectId = event.target.value
                  const project = projects.find((row) => row.id === projectId)
                  setRateForm((prev) => ({ ...prev, projectId, clientId: project?.client_id ?? prev.clientId }))
                }}
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
              <span>クライアント</span>
              <select value={rateForm.clientId} onChange={(event) => setRateForm((prev) => ({ ...prev, clientId: event.target.value }))} style={inputStyle}>
                <option value="">自動判定</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>項目種別</span>
              <input value={rateForm.itemType} onChange={(event) => setRateForm((prev) => ({ ...prev, itemType: event.target.value }))} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>単位</span>
              <input value={rateForm.unitLabel} onChange={(event) => setRateForm((prev) => ({ ...prev, unitLabel: event.target.value }))} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>売上単価</span>
              <input type="number" min="0" value={rateForm.salesUnitPrice} onChange={(event) => setRateForm((prev) => ({ ...prev, salesUnitPrice: event.target.value }))} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>原価</span>
              <input type="number" min="0" value={rateForm.standardCost} onChange={(event) => setRateForm((prev) => ({ ...prev, standardCost: event.target.value }))} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>開始日</span>
              <input type="date" value={rateForm.effectiveFrom} onChange={(event) => setRateForm((prev) => ({ ...prev, effectiveFrom: event.target.value }))} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>終了日</span>
              <input type="date" value={rateForm.effectiveTo} onChange={(event) => setRateForm((prev) => ({ ...prev, effectiveTo: event.target.value }))} style={inputStyle} />
            </label>
            <button type="button" onClick={() => void createRateCard()} disabled={rateBusy} style={buttonPrimaryStyle}>
              {rateBusy ? "登録中..." : "単価ルールを登録"}
            </button>
          </div>
        </ProjectSection>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
        <ProjectSection title="最近の経費">
          <div style={{ overflowX: "auto" }}>
            <table style={{ ...tableStyle, minWidth: 560 }}>
              <thead>
                <tr>
                  <th style={thStyle}>日付</th>
                  <th style={thStyle}>案件</th>
                  <th style={thStyle}>カテゴリ</th>
                  <th style={thStyle}>内容</th>
                  <th style={thStyle}>金額</th>
                </tr>
              </thead>
              <tbody>
                {filteredExpenses.slice(0, 12).map((expense) => (
                  <tr key={expense.id}>
                    <td style={tdStyle}>{expense.occurred_on}</td>
                    <td style={tdStyle}>{projectNameById.get(expense.project_id ?? "") ?? "-"}</td>
                    <td style={tdStyle}>{expense.category}</td>
                    <td style={tdStyle}>{expense.description}</td>
                    <td style={tdStyle}>{formatCurrency(Number(expense.amount ?? 0))}</td>
                  </tr>
                ))}
                {filteredExpenses.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={tdStyle}>経費はありません。</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </ProjectSection>

        <ProjectSection title="単価ルール一覧">
          <div style={{ overflowX: "auto" }}>
            <table style={{ ...tableStyle, minWidth: 680 }}>
              <thead>
                <tr>
                  <th style={thStyle}>案件</th>
                  <th style={thStyle}>項目</th>
                  <th style={thStyle}>単位</th>
                  <th style={thStyle}>売上単価</th>
                  <th style={thStyle}>原価</th>
                  <th style={thStyle}>適用期間</th>
                </tr>
              </thead>
              <tbody>
                {filteredRateCards.slice(0, 12).map((rateCard) => (
                  <tr key={rateCard.id}>
                    <td style={tdStyle}>{projectNameById.get(rateCard.project_id ?? "") ?? "-"}</td>
                    <td style={tdStyle}>{rateCard.item_type}</td>
                    <td style={tdStyle}>{rateCard.unit_label}</td>
                    <td style={tdStyle}>{formatCurrency(Number(rateCard.sales_unit_price ?? 0))}</td>
                    <td style={tdStyle}>{formatCurrency(Number(rateCard.standard_cost ?? 0))}</td>
                    <td style={tdStyle}>
                      {rateCard.effective_from}
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>- {rateCard.effective_to || "-"}</div>
                    </td>
                  </tr>
                ))}
                {filteredRateCards.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={tdStyle}>単価ルールはありません。</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </ProjectSection>
      </div>
    </ProjectShell>
  )
}
