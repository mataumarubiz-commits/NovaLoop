export type ContentReviewRound = {
  id: string
  content_id: string
  round_no: number
  status: "open" | "changes_requested" | "approved"
  summary: string | null
  due_at: string | null
  reviewer_user_id: string | null
  created_at: string
  updated_at: string
}

export type ContentReviewComment = {
  id: string
  content_id: string
  round_id: string
  body: string
  timecode_seconds: number | null
  timecode_label: string | null
  status: "open" | "resolved"
  resolved_at: string | null
  resolved_by: string | null
  author_user_id: string | null
  created_at: string
  updated_at: string
}

export function formatReviewTimecode(seconds: number | null, label?: string | null) {
  if (label?.trim()) return label.trim()
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return ""
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remain = total % 60
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remain).padStart(2, "0")}`
  }
  return `${String(minutes).padStart(2, "0")}:${String(remain).padStart(2, "0")}`
}

export function parseReviewTimecode(value: string) {
  const normalized = value.trim()
  if (!normalized) {
    return { seconds: null, label: null }
  }

  const parts = normalized.split(":").map((part) => part.trim())
  if (parts.some((part) => !/^\d+$/.test(part))) {
    return { seconds: null, label: normalized }
  }

  if (parts.length === 2) {
    const minutes = Number(parts[0])
    const seconds = Number(parts[1])
    return { seconds: minutes * 60 + seconds, label: formatReviewTimecode(minutes * 60 + seconds, normalized) }
  }

  if (parts.length === 3) {
    const hours = Number(parts[0])
    const minutes = Number(parts[1])
    const seconds = Number(parts[2])
    const total = hours * 3600 + minutes * 60 + seconds
    return { seconds: total, label: formatReviewTimecode(total, normalized) }
  }

  return { seconds: null, label: normalized }
}

export function nextReviewRoundNo(rounds: Array<Pick<ContentReviewRound, "round_no">>) {
  return rounds.reduce((max, round) => Math.max(max, round.round_no), 0) + 1
}
