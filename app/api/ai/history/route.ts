import { NextRequest, NextResponse } from "next/server"
import { getAiActorFromRequest } from "@/lib/aiAuth"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import type { AiHistoryItem, AiMode, AiResultKind, AiSource } from "@/lib/aiClientEvents"
import { parseAiHistorySearchParams, VALID_AI_HISTORY_KINDS, VALID_AI_HISTORY_MODES, VALID_AI_HISTORY_SOURCES } from "@/lib/ai/historyFilters"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const actor = await getAiActorFromRequest(req)
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const filters = parseAiHistorySearchParams(req.nextUrl.searchParams)
  const admin = createSupabaseAdmin()
  let query = admin
    .from("ai_logs")
    .select("id, source, mode, result_kind, output_text, created_at, apply_target, meta")
    .eq("org_id", actor.orgId)
    .eq("user_id", actor.userId)
    .eq("success", true)
    .not("output_text", "is", null)
    .order("created_at", { ascending: false })
    .limit(filters.limit)

  if (filters.source) {
    query = query.eq("source", filters.source)
  }

  if (filters.mode) {
    query = query.eq("mode", filters.mode)
  }

  if (filters.applyTarget) {
    query = query.eq("apply_target", filters.applyTarget)
  }

  if (filters.recordId) {
    query = query.contains("meta", { recordId: filters.recordId })
  }

  if (filters.sourceObject) {
    query = query.contains("meta", { sourceObject: filters.sourceObject })
  }

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ error: "AI履歴の取得に失敗しました。" }, { status: 500 })
  }

  const items: AiHistoryItem[] = ((data ?? []) as Array<Record<string, unknown>>).flatMap((row) => {
    const source = String(row.source ?? "")
    const mode = String(row.mode ?? "")
    const kind = String(row.result_kind ?? "")
    const text = String(row.output_text ?? "")

    if (
      !VALID_AI_HISTORY_SOURCES.includes(source) ||
      !VALID_AI_HISTORY_MODES.includes(mode) ||
      !VALID_AI_HISTORY_KINDS.includes(kind) ||
      !text.trim()
    ) {
      return []
    }

    return [
      {
        id: String(row.id ?? ""),
        source: source as AiSource,
        mode: mode as AiMode,
        kind: kind as AiResultKind,
        text,
        createdAt: String(row.created_at ?? ""),
        applyTarget: typeof row.apply_target === "string" ? row.apply_target : null,
        meta: row.meta && typeof row.meta === "object" ? (row.meta as Record<string, unknown>) : null,
      },
    ]
  })

  return NextResponse.json({ items })
}
