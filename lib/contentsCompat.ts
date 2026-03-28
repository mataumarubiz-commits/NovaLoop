const LINKS_JSON_FIELD = "links_json"

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
