type CompatibleError = { message?: string | null } | null | undefined

function normalizeColumns(columns: string[]) {
  return Array.from(new Set(columns.map((column) => column.trim()).filter(Boolean)))
}

export function extractMissingColumn(table: string, error: CompatibleError) {
  const message = error?.message ?? null
  if (!message) return null

  const patterns = [
    new RegExp(`column\\s+(?:public\\.)?${table}\\.([a-zA-Z0-9_]+)\\s+does not exist`, "i"),
    new RegExp(`Could not find the '([a-zA-Z0-9_]+)' column of '${table}'`, "i"),
    new RegExp(`Could not find the column '([a-zA-Z0-9_]+)' of '${table}'`, "i"),
  ]

  for (const pattern of patterns) {
    const match = message.match(pattern)
    if (match?.[1]) return match[1]
  }

  return null
}

export async function selectWithColumnFallback<T>(params: {
  table: string
  columns: string[]
  execute: (columnsCsv: string) => Promise<{ data: T | null | undefined; error: CompatibleError }>
}) {
  let columns = normalizeColumns(params.columns)
  const removedColumns = new Set<string>()

  while (columns.length > 0) {
    const result = await params.execute(columns.join(", "))
    if (!result.error) {
      return {
        data: (result.data ?? null) as T | null,
        columns,
      }
    }

    const missingColumn = extractMissingColumn(params.table, result.error)
    if (!missingColumn || !columns.includes(missingColumn) || removedColumns.has(missingColumn)) {
      throw new Error(result.error.message ?? `${params.table} の取得に失敗しました。`)
    }

    columns = columns.filter((column) => column !== missingColumn)
    removedColumns.add(missingColumn)
  }

  throw new Error(`${params.table} で利用可能なカラムを特定できませんでした。`)
}

export async function writeWithColumnFallback<T>(params: {
  table: string
  payload: Record<string, unknown>
  execute: (payload: Record<string, unknown>) => Promise<{ data: T | null | undefined; error: CompatibleError }>
}) {
  let payload = { ...params.payload }
  const removedColumns = new Set<string>()

  while (Object.keys(payload).length > 0) {
    const result = await params.execute(payload)
    if (!result.error) {
      return {
        data: (result.data ?? null) as T | null,
        payload,
      }
    }

    const missingColumn = extractMissingColumn(params.table, result.error)
    if (!missingColumn || !(missingColumn in payload) || removedColumns.has(missingColumn)) {
      throw new Error(result.error.message ?? `${params.table} の保存に失敗しました。`)
    }

    const nextPayload = { ...payload }
    delete nextPayload[missingColumn]
    payload = nextPayload
    removedColumns.add(missingColumn)
  }

  throw new Error(`${params.table} に保存できるカラムが見つかりませんでした。`)
}
