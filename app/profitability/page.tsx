"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { FinanceOpsShell } from "@/components/finance/FinanceOpsShell"
import { ProjectInfoCard, ProjectSection } from "@/components/project/ProjectShell"
import { formatCurrency, inputStyle, tableStyle, tdStyle, textOrDash, thStyle } from "@/components/project/projectPageStyles"
import { useProjectWorkspace } from "@/hooks/useProjectWorkspace"

function formatPercent(value: number | null) {
  return value == null ? "-" : `${Math.round(value * 100)}%`
}

function safeNumber(value: unknown) {
  const num = Number(value ?? 0)
  return Number.isFinite(num) ? num : 0
}

export default function ProfitabilityPage() {
  const searchParams = useSearchParams()
  const initialProjectId = searchParams.get("projectId") ?? ""
  const {
    loading,
    error,
    canViewFinance,
    month,
    projects,
    contents,
    expenses,
    invoices,
    invoiceLines,
    vendorInvoices,
    vendorInvoiceLines,
    projectSummaries,
  } = useProjectWorkspace({ requireAdminSurface: true })
  const [projectFilter, setProjectFilter] = useState(initialProjectId)

  const projectNameById = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects])

  const filteredSummaries = useMemo(
    () => projectSummaries.filter((summary) => !projectFilter || summary.project.id === projectFilter),
    [projectFilter, projectSummaries]
  )
  const filteredExpenses = useMemo(
    () => expenses.filter((expense) => !projectFilter || expense.project_id === projectFilter),
    [expenses, projectFilter]
  )
  const filteredContents = useMemo(
    () => contents.filter((content) => !projectFilter || content.project_id === projectFilter),
    [contents, projectFilter]
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

  const contentProfitability = useMemo(
    () =>
      filteredContents
        .map((content) => {
          const sales = contentSalesById.get(content.id) ?? safeNumber(content.unit_price)
          const cost = contentCostById.get(content.id) ?? safeNumber(content.estimated_cost)
          const linkedExpenses = filteredExpenses
            .filter((expense) => expense.content_id === content.id)
            .reduce((sum, expense) => sum + safeNumber(expense.amount), 0)
          const gross = sales - cost - linkedExpenses
          return {
            ...content,
            sales,
            cost,
            linkedExpenses,
            gross,
            marginRate: sales > 0 ? gross / sales : null,
          }
        })
        .sort((a, b) => (a.marginRate ?? -1) - (b.marginRate ?? -1)),
    [contentCostById, contentSalesById, filteredContents, filteredExpenses]
  )

  const monthlyTrend = useMemo(() => {
    const monthMap = new Map<string, { sales: number; vendorCost: number; expense: number }>()

    for (const content of filteredContents) {
      const targetMonth = (content.delivery_month || content.due_client_at).slice(0, 7)
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

    return [...monthMap.entries()]
      .map(([targetMonth, values]) => ({
        month: targetMonth,
        sales: values.sales,
        vendorCost: values.vendorCost,
        expense: values.expense,
        gross: values.sales - values.vendorCost - values.expense,
      }))
      .sort((a, b) => b.month.localeCompare(a.month))
  }, [contentCostById, contentSalesById, filteredContents, filteredExpenses])

  if (loading) {
    return <FinanceOpsShell title="粗利台帳" description="案件別の売上、外注原価、経費、粗利を横断確認します。">読み込み中...</FinanceOpsShell>
  }

  if (!canViewFinance) {
    return (
      <FinanceOpsShell title="粗利台帳" description="案件別の売上、外注原価、経費、粗利を横断確認します。">
        <ProjectSection title="権限不足">この画面は owner / executive_assistant のみ利用できます。</ProjectSection>
      </FinanceOpsShell>
    )
  }

  return (
    <FinanceOpsShell
      title="粗利台帳"
      description="既存の請求、外注、経費データから案件別・コンテンツ別の粗利を確認します。"
      action={
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/close" style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", textDecoration: "none", color: "var(--text)" }}>
            締めに戻る
          </Link>
          <Link href="/expenses" style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", textDecoration: "none", color: "var(--text)" }}>
            経費を見る
          </Link>
        </div>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <ProjectInfoCard label="対象月" value={month} />
        <ProjectInfoCard label="売上" value={formatCurrency(totals.sales)} />
        <ProjectInfoCard label="外注原価" value={formatCurrency(totals.vendorCost)} />
        <ProjectInfoCard label="経費" value={formatCurrency(totals.expense)} />
        <ProjectInfoCard label="粗利" value={formatCurrency(totals.gross)} accent={totals.gross < 0 ? "var(--error-text)" : undefined} />
        <ProjectInfoCard label="低粗利案件" value={`${lowMarginProjects.length}件`} accent={lowMarginProjects.length > 0 ? "var(--warning-text)" : undefined} />
      </div>

      {error ? (
        <ProjectSection title="読込エラー">
          <div style={{ color: "var(--error-text)" }}>{error}</div>
        </ProjectSection>
      ) : null}

      <ProjectSection title="絞り込み" description="案件単位で粗利を確認できます。">
        <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 360px)", gap: 12 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span>案件</span>
            <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} style={inputStyle}>
              <option value="">すべての案件</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </ProjectSection>

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
        <ProjectSection title="低粗利案件" description="粗利率 35% 未満、または赤字の案件です。">
          <div style={{ overflowX: "auto" }}>
            <table style={{ ...tableStyle, minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={thStyle}>案件</th>
                  <th style={thStyle}>売上</th>
                  <th style={thStyle}>外注原価</th>
                  <th style={thStyle}>経費</th>
                  <th style={thStyle}>粗利率</th>
                </tr>
              </thead>
              <tbody>
                {lowMarginProjects.map((summary) => (
                  <tr key={summary.project.id}>
                    <td style={tdStyle}>
                      <Link href={`/projects/${encodeURIComponent(summary.project.id)}`} style={{ color: "var(--primary)", textDecoration: "none", fontWeight: 700 }}>
                        {summary.project.name}
                      </Link>
                    </td>
                    <td style={tdStyle}>{formatCurrency(summary.monthlySales)}</td>
                    <td style={tdStyle}>{formatCurrency(summary.monthlyVendorCost)}</td>
                    <td style={tdStyle}>{formatCurrency(summary.monthlyExpenses)}</td>
                    <td style={{ ...tdStyle, color: (summary.marginRate ?? 1) < 0.35 ? "var(--warning-text)" : tdStyle.color }}>
                      {formatPercent(summary.marginRate)}
                    </td>
                  </tr>
                ))}
                {lowMarginProjects.length === 0 ? (
                  <tr>
                    <td style={tdStyle} colSpan={5}>低粗利案件はありません。</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </ProjectSection>

        <ProjectSection title="月次推移" description="売上、原価、経費、粗利を月次で比較します。">
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
                    <td style={tdStyle} colSpan={5}>集計できる月次データはまだありません。</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </ProjectSection>
      </div>

      <ProjectSection title="案件別収支" description="請求と外注の確定値があれば優先し、未確定部分は contents の単価と想定原価を使います。">
        <div style={{ overflowX: "auto" }}>
          <table style={{ ...tableStyle, minWidth: 1080 }}>
            <thead>
              <tr>
                <th style={thStyle}>案件</th>
                <th style={thStyle}>当月本数</th>
                <th style={thStyle}>売上</th>
                <th style={thStyle}>外注原価</th>
                <th style={thStyle}>経費</th>
                <th style={thStyle}>粗利</th>
                <th style={thStyle}>粗利率</th>
              </tr>
            </thead>
            <tbody>
              {filteredSummaries.map((summary) => (
                <tr key={summary.project.id}>
                  <td style={tdStyle}>
                    <Link href={`/projects/${encodeURIComponent(summary.project.id)}`} style={{ color: "var(--primary)", textDecoration: "none", fontWeight: 700 }}>
                      {summary.project.name}
                    </Link>
                  </td>
                  <td style={tdStyle}>{summary.monthlyContentCount}</td>
                  <td style={tdStyle}>{formatCurrency(summary.monthlySales)}</td>
                  <td style={tdStyle}>{formatCurrency(summary.monthlyVendorCost)}</td>
                  <td style={tdStyle}>{formatCurrency(summary.monthlyExpenses)}</td>
                  <td style={{ ...tdStyle, color: summary.grossProfit < 0 ? "var(--error-text)" : tdStyle.color }}>{formatCurrency(summary.grossProfit)}</td>
                  <td style={{ ...tdStyle, color: (summary.marginRate ?? 1) < 0.35 ? "var(--warning-text)" : tdStyle.color }}>
                    {formatPercent(summary.marginRate)}
                  </td>
                </tr>
              ))}
              {filteredSummaries.length === 0 ? (
                <tr>
                  <td style={tdStyle} colSpan={7}>対象案件がありません。</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </ProjectSection>

      <ProjectSection title="コンテンツ別収支" description="案件内で粗利が崩れているコンテンツを先に見つけます。">
        <div style={{ overflowX: "auto" }}>
          <table style={{ ...tableStyle, minWidth: 1180 }}>
            <thead>
              <tr>
                <th style={thStyle}>案件</th>
                <th style={thStyle}>コンテンツ</th>
                <th style={thStyle}>売上</th>
                <th style={thStyle}>外注原価</th>
                <th style={thStyle}>直接経費</th>
                <th style={thStyle}>粗利</th>
                <th style={thStyle}>粗利率</th>
              </tr>
            </thead>
            <tbody>
              {contentProfitability.slice(0, 40).map((content) => (
                <tr key={content.id}>
                  <td style={tdStyle}>{textOrDash(projectNameById.get(content.project_id ?? ""))}</td>
                  <td style={tdStyle}>{content.title}</td>
                  <td style={tdStyle}>{formatCurrency(content.sales)}</td>
                  <td style={tdStyle}>{formatCurrency(content.cost)}</td>
                  <td style={tdStyle}>{formatCurrency(content.linkedExpenses)}</td>
                  <td style={{ ...tdStyle, color: content.gross < 0 ? "var(--error-text)" : tdStyle.color }}>{formatCurrency(content.gross)}</td>
                  <td style={{ ...tdStyle, color: (content.marginRate ?? 1) < 0.35 ? "var(--warning-text)" : tdStyle.color }}>
                    {formatPercent(content.marginRate)}
                  </td>
                </tr>
              ))}
              {contentProfitability.length === 0 ? (
                <tr>
                  <td style={tdStyle} colSpan={7}>対象コンテンツがありません。</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </ProjectSection>
    </FinanceOpsShell>
  )
}
