import { NextRequest, NextResponse } from "next/server"
import {
  ensureContentLinksJsonRow,
  isMissingContentsLinksJsonColumn,
  removeLinksJsonFromSelect,
} from "@/lib/contentsCompat"
import { getOrgRole, getUserIdFromToken } from "@/lib/apiAuth"
import {
  applyProgressSignal,
  normalizeAutomationContentDates,
  syncAutomationArtifacts,
} from "@/lib/projectAutomation"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Body = {
  contentId?: string
  externalRef?: string
  projectId?: string
  signal?:
    | "editor_submitted"
    | "client_submitted"
    | "material_received"
    | "published"
    | "slack_reaction_submitted"
    | "discord_material_received"
    | "chatwork_client_submitted"
    | "drive_material_uploaded"
  source?: string
  occurredAt?: string
}

const CONTENT_SELECT = [
  "id",
  "org_id",
  "project_id",
  "project_name",
  "title",
  "due_client_at",
  "due_editor_at",
  "publish_at",
  "status",
  "billable_flag",
  "delivery_month",
  "unit_price",
  "invoice_id",
  "assignee_editor_user_id",
  "assignee_checker_user_id",
  "revision_count",
  "estimated_cost",
  "next_action",
  "blocked_reason",
  "material_status",
  "draft_status",
  "final_status",
  "health_score",
  "links_json",
  "editor_submitted_at",
  "client_submitted_at",
].join(", ")
const CONTENT_SELECT_LEGACY = removeLinksJsonFromSelect(CONTENT_SELECT)

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserIdFromToken(req)
    if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })

    const body = (await req.json().catch(() => null)) as Body | null
    const signal = body?.signal ?? null
    if (
      signal !== "editor_submitted" &&
      signal !== "client_submitted" &&
      signal !== "material_received" &&
      signal !== "published" &&
      signal !== "slack_reaction_submitted" &&
      signal !== "discord_material_received" &&
      signal !== "chatwork_client_submitted" &&
      signal !== "drive_material_uploaded"
    ) {
      return NextResponse.json({ ok: false, error: "signal is required" }, { status: 400 })
    }

    if (!body?.contentId && !body?.externalRef) {
      return NextResponse.json({ ok: false, error: "contentId or externalRef is required" }, { status: 400 })
    }

    const admin = createSupabaseAdmin()
    const { data: profile } = await admin
      .from("user_profiles")
      .select("active_org_id")
      .eq("user_id", userId)
      .maybeSingle()
    const orgId = (profile as { active_org_id?: string | null } | null)?.active_org_id ?? null
    if (!orgId) return NextResponse.json({ ok: false, error: "Active org not found" }, { status: 400 })

    const role = await getOrgRole(admin, userId, orgId)
    if (!role) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 })

    const loadContent = async (selectClause: string) => {
      let contentQuery = admin.from("contents").select(selectClause).eq("org_id", orgId)
      if (body.contentId) {
        contentQuery = contentQuery.eq("id", body.contentId)
      } else {
        contentQuery = contentQuery.eq("external_ref", body.externalRef ?? "")
        if (body.projectId) contentQuery = contentQuery.eq("project_id", body.projectId)
      }
      return contentQuery.maybeSingle()
    }

    let { data: contentRow, error: contentError } = await loadContent(CONTENT_SELECT)
    if (contentError && isMissingContentsLinksJsonColumn(contentError.message)) {
      ;({ data: contentRow, error: contentError } = await loadContent(CONTENT_SELECT_LEGACY))
    }
    if (contentError) return NextResponse.json({ ok: false, error: contentError.message }, { status: 500 })
    if (!contentRow) return NextResponse.json({ ok: false, error: "Content not found" }, { status: 404 })

    const content = ensureContentLinksJsonRow(contentRow as unknown as Record<string, unknown>)
    let project:
      | {
          id: string
          name: string
          chatwork_room_id?: string | null
          google_calendar_id?: string | null
          slack_channel_id?: string | null
          discord_channel_id?: string | null
          drive_folder_url?: string | null
        }
      | null = null

    if (typeof content.project_id === "string" && content.project_id) {
      const { data: projectRow } = await admin
        .from("projects")
        .select("id, name, chatwork_room_id, google_calendar_id, slack_channel_id, discord_channel_id, drive_folder_url")
        .eq("org_id", orgId)
        .eq("id", content.project_id)
        .maybeSingle()
      project = (projectRow as typeof project | null) ?? null
    }

    const occurredAt =
      typeof body.occurredAt === "string" && body.occurredAt.trim().length > 0
        ? body.occurredAt
        : new Date().toISOString()
    const todayYmd = occurredAt.slice(0, 10)
    const originalContent = {
      id: String(content.id),
      org_id: String(content.org_id),
      project_id: typeof content.project_id === "string" ? content.project_id : null,
      project_name: String(content.project_name ?? ""),
      title: String(content.title ?? ""),
      due_client_at: String(content.due_client_at ?? ""),
      due_editor_at: String(content.due_editor_at ?? ""),
      publish_at: typeof content.publish_at === "string" ? content.publish_at : null,
      status: String(content.status ?? "not_started"),
      billable_flag: Boolean(content.billable_flag),
      delivery_month: String(content.delivery_month ?? ""),
      unit_price: Number(content.unit_price ?? 0),
      invoice_id: typeof content.invoice_id === "string" ? content.invoice_id : null,
      assignee_editor_user_id: typeof content.assignee_editor_user_id === "string" ? content.assignee_editor_user_id : null,
      assignee_checker_user_id: typeof content.assignee_checker_user_id === "string" ? content.assignee_checker_user_id : null,
      revision_count: Number(content.revision_count ?? 0),
      estimated_cost: Number(content.estimated_cost ?? 0),
      next_action: typeof content.next_action === "string" ? content.next_action : null,
      blocked_reason: typeof content.blocked_reason === "string" ? content.blocked_reason : null,
      material_status: typeof content.material_status === "string" ? content.material_status : null,
      draft_status: typeof content.draft_status === "string" ? content.draft_status : null,
      final_status: typeof content.final_status === "string" ? content.final_status : null,
      health_score: Number(content.health_score ?? 100),
      links_json: content.links_json,
      editor_submitted_at: typeof content.editor_submitted_at === "string" ? content.editor_submitted_at : null,
      client_submitted_at: typeof content.client_submitted_at === "string" ? content.client_submitted_at : null,
    }
    const progressed = applyProgressSignal({
      content: originalContent,
      signal,
      occurredAt,
      sourceLabel: typeof body.source === "string" ? body.source : null,
    })

    const normalized = normalizeAutomationContentDates({
      previous: originalContent,
      next: progressed,
      todayYmd,
      project,
    })

    const { error: updateError } = await admin
      .from("contents")
      .update({
        status: normalized.status,
        material_status: normalized.material_status,
        final_status: normalized.final_status,
        next_action: normalized.next_action,
        delivery_month: normalized.delivery_month,
        due_client_at: normalized.due_client_at,
        due_editor_at: normalized.due_editor_at,
        publish_at: normalized.publish_at,
        health_score: normalized.health_score,
        editor_submitted_at: normalized.editor_submitted_at ?? null,
        client_submitted_at: normalized.client_submitted_at ?? null,
      })
      .eq("id", normalized.id)
      .eq("org_id", orgId)
    if (updateError) return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 })

    await syncAutomationArtifacts({
      db: admin,
      orgId,
      previous: originalContent,
      next: normalized,
      project,
      todayYmd,
      actorUserId: userId,
    })

    return NextResponse.json({
      ok: true,
      contentId: normalized.id,
      status: normalized.status,
      materialStatus: normalized.material_status,
      editorSubmittedAt: normalized.editor_submitted_at ?? null,
      clientSubmittedAt: normalized.client_submitted_at ?? null,
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to update project progress" },
      { status: 500 }
    )
  }
}
