export const DISCORD_EPHEMERAL_FLAG = 64

export const INCOMPLETE_CONTENT_STATUSES = new Set([
  "not_started",
  "materials_confirmed",
  "materials_checked",
  "editing",
  "internal_production",
  "internal_revision",
  "editor_revision",
  "submitted_to_client",
  "client_submission",
  "client_revision",
  "client_revision_work",
  "scheduling",
  "paused",
])

export type DiscordActionRow = {
  type: 1
  components: Array<Record<string, unknown>>
}

export function trimForDiscord(value: unknown, fallback = "-") {
  const text = String(value ?? "").trim()
  if (!text) return fallback
  return text.length > 1800 ? `${text.slice(0, 1800)}...` : text
}

export function parseStrictYmd(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null
  const date = new Date(`${trimmed}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return null
  const normalized = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate()
  ).padStart(2, "0")}`
  return normalized === trimmed ? trimmed : null
}

export function addDaysYmd(ymd: string, days: number) {
  const date = new Date(`${ymd}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate()
  ).padStart(2, "0")}`
}

export function toYmFromYmd(ymd: string) {
  return ymd.slice(0, 7)
}

export function todayYmd() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

export function normalizeClientName(value: string) {
  return value
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/^株式会社\s*/, "")
    .replace(/\s*株式会社$/, "")
    .replace(/^有限会社\s*/, "")
    .replace(/\s*有限会社$/, "")
    .replace(/^合同会社\s*/, "")
    .replace(/\s*合同会社$/, "")
}

export function statusLabel(status: unknown) {
  switch (String(status ?? "")) {
    case "not_started":
      return "未着手"
    case "materials_confirmed":
    case "materials_checked":
      return "素材確認済み"
    case "editing":
    case "internal_production":
      return "制作中"
    case "internal_revision":
    case "editor_revision":
      return "修正中"
    case "submitted_to_client":
    case "client_submission":
      return "先方確認中"
    case "client_revision":
    case "client_revision_work":
      return "先方修正中"
    case "scheduling":
      return "公開準備"
    case "delivered":
      return "納品完了"
    case "invoiced":
      return "請求済み"
    case "published":
    case "completed":
      return "完了"
    case "paused":
      return "保留"
    case "canceled":
    case "cancelled":
    case "rejected":
      return "停止"
    default:
      return "未設定"
  }
}

export function buildProjectsContentPath(content: {
  id: string
  project_id?: string | null
}) {
  if (content.project_id) {
    return `/projects/${encodeURIComponent(content.project_id)}?tab=contents&highlight=${encodeURIComponent(content.id)}`
  }
  return `/projects?highlight=${encodeURIComponent(content.id)}`
}

export function absoluteAppUrl(baseUrl: string, path: string) {
  const cleanBase = baseUrl.replace(/\/+$/, "")
  if (!cleanBase) return path
  return `${cleanBase}${path.startsWith("/") ? path : `/${path}`}`
}

export function linkButton(label: string, url: string) {
  return {
    type: 2,
    style: 5,
    label,
    url,
  }
}

export function actionRows(buttons: Array<Record<string, unknown>>): DiscordActionRow[] {
  const rows: DiscordActionRow[] = []
  for (let index = 0; index < buttons.length; index += 5) {
    rows.push({ type: 1, components: buttons.slice(index, index + 5) })
  }
  return rows
}
