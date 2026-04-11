const LINKS_JSON_FIELD = "links_json"
const WORK_ITEM_FIELDS = [
  "workload_points",
  "estimated_cost",
  "next_action",
  "blocked_reason",
  "material_status",
  "draft_status",
  "final_status",
  "health_score",
] as const

function splitSelectColumns(selectClause: string) {
  return selectClause
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean)
}

export function removeLinksJsonFromSelect(selectClause: string) {
  return splitSelectColumns(selectClause)
    .filter((column) => column !== LINKS_JSON_FIELD)
    .join(", ")
}

export function removeWorkItemFieldsFromSelect(selectClause: string) {
  return splitSelectColumns(selectClause)
    .filter((column) => !WORK_ITEM_FIELDS.includes(column as (typeof WORK_ITEM_FIELDS)[number]))
    .join(", ")
}

export function isMissingContentsLinksJsonColumn(message?: string | null) {
  const raw = String(message ?? "").toLowerCase()
  if (!raw.includes("links_json")) return false
  return (
    raw.includes("does not exist") ||
    raw.includes("schema cache") ||
    raw.includes("could not find") ||
    raw.includes("column")
  )
}

export function isMissingContentsWorkItemFieldsColumn(message?: string | null) {
  const raw = String(message ?? "").toLowerCase()
  if (!WORK_ITEM_FIELDS.some((field) => raw.includes(field))) return false
  return (
    raw.includes("does not exist") ||
    raw.includes("schema cache") ||
    raw.includes("could not find") ||
    raw.includes("column")
  )
}

export function ensureContentLinksJsonRow<T extends Record<string, unknown>>(row: T) {
  if (Object.prototype.hasOwnProperty.call(row, LINKS_JSON_FIELD)) {
    return row as T & { links_json: unknown }
  }
  return {
    ...row,
    links_json: {},
  } as T & { links_json: unknown }
}

export function ensureContentLinksJsonRows<T extends Record<string, unknown>>(rows: T[] | null | undefined) {
  return (rows ?? []).map((row) => ensureContentLinksJsonRow(row))
}

function sanitizeContentWriteRow<T extends Record<string, unknown>>(
  row: T,
  options: {
    supportsLinksJson: boolean
    supportsWorkItemFields: boolean
  }
) {
  const next = { ...row }
  if (!options.supportsLinksJson) {
    delete next[LINKS_JSON_FIELD]
  }
  if (!options.supportsWorkItemFields) {
    for (const field of WORK_ITEM_FIELDS) {
      delete next[field]
    }
  }
  return next
}

export function sanitizeContentWritePayload<T extends Record<string, unknown>>(
  payload: T | T[],
  options: {
    supportsLinksJson: boolean
    supportsWorkItemFields: boolean
  }
) {
  return Array.isArray(payload)
    ? payload.map((row) => sanitizeContentWriteRow(row, options))
    : sanitizeContentWriteRow(payload, options)
}
