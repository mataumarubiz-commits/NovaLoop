import { NextRequest, NextResponse } from "next/server"
import { getBearerToken, createUserClient } from "@/lib/userClient"
import {
  DRAFT_STATUS_OPTIONS,
  FINAL_STATUS_OPTIONS,
  MATERIAL_STATUS_OPTIONS,
  WORKFLOW_STATUS_OPTIONS,
  normalizeContentWorkflowOptions,
} from "@/lib/contentWorkflow"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function getAuth(req: NextRequest) {
  const token = getBearerToken(req)
  if (!token) return { error: NextResponse.json({ ok: false, message: "認証が必要です" }, { status: 401 }) }

  const supabase = createUserClient(token)
  if (!supabase) {
    return { error: NextResponse.json({ ok: false, message: "Supabase 設定が不足しています" }, { status: 500 }) }
  }
  const { data } = await supabase.auth.getUser(token)
  const userId = data.user?.id ?? null
  if (!userId) return { error: NextResponse.json({ ok: false, message: "認証が必要です" }, { status: 401 }) }
  return { supabase, userId }
}

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuth(req)
    if ("error" in auth) return auth.error
    const { supabase, userId } = auth

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("active_org_id")
      .eq("user_id", userId)
      .maybeSingle()
    const orgId = (profile as { active_org_id?: string | null } | null)?.active_org_id
    if (!orgId) {
      return NextResponse.json({ ok: false, message: "ワークスペースを選択してください" }, { status: 400 })
    }

    const [{ data: settings }, { data: org }] = await Promise.all([
      supabase.from("org_settings").select("*").eq("org_id", orgId).maybeSingle(),
      supabase.from("organizations").select("id, name").eq("id", orgId).maybeSingle(),
    ])

    return NextResponse.json(
      {
        ok: true,
        orgId,
        organization: org ?? null,
        settings:
          settings ?? {
            org_id: orgId,
            business_entity_type: "corporate",
            invoice_seq: 1,
            content_status_options: normalizeContentWorkflowOptions(undefined, WORKFLOW_STATUS_OPTIONS),
            content_material_status_options: normalizeContentWorkflowOptions(undefined, MATERIAL_STATUS_OPTIONS),
            content_draft_status_options: normalizeContentWorkflowOptions(undefined, DRAFT_STATUS_OPTIONS),
            content_final_status_options: normalizeContentWorkflowOptions(undefined, FINAL_STATUS_OPTIONS),
          },
      },
      { status: 200 }
    )
  } catch (e) {
    console.error("[api/org-settings] GET", e)
    return NextResponse.json({ ok: false, message: "取得に失敗しました" }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await getAuth(req)
    if ("error" in auth) return auth.error
    const { supabase, userId } = auth

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("active_org_id")
      .eq("user_id", userId)
      .maybeSingle()
    const orgId = (profile as { active_org_id?: string | null } | null)?.active_org_id
    if (!orgId) {
      return NextResponse.json({ ok: false, message: "ワークスペースを選択してください" }, { status: 400 })
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const workspaceName = typeof body.workspace_name === "string" ? body.workspace_name.trim() : ""
    const payload = {
      org_id: orgId,
      business_entity_type:
        body.business_entity_type === "sole_proprietor" ? "sole_proprietor" : "corporate",
      issuer_name: typeof body.issuer_name === "string" ? body.issuer_name.trim() : null,
      issuer_zip: typeof body.issuer_zip === "string" ? body.issuer_zip.trim() : null,
      issuer_address: typeof body.issuer_address === "string" ? body.issuer_address.trim() : null,
      issuer_phone: typeof body.issuer_phone === "string" ? body.issuer_phone.trim() : null,
      issuer_email: typeof body.issuer_email === "string" ? body.issuer_email.trim() : null,
      issuer_registration_number:
        typeof body.issuer_registration_number === "string" ? body.issuer_registration_number.trim() : null,
      invoice_note_fixed: typeof body.invoice_note_fixed === "string" ? body.invoice_note_fixed.trim() : null,
      payout_csv_format:
        body.payout_csv_format === "custom_basic" ? "custom_basic" : "zengin_simple",
      payout_csv_encoding: "utf8_bom",
      payout_csv_delimiter: "comma",
      payout_csv_depositor_code:
        typeof body.payout_csv_depositor_code === "string" ? body.payout_csv_depositor_code.trim() : null,
      payout_csv_company_name_kana:
        typeof body.payout_csv_company_name_kana === "string" ? body.payout_csv_company_name_kana.trim() : null,
      payout_csv_notes:
        typeof body.payout_csv_notes === "string" ? body.payout_csv_notes.trim() : null,
      content_status_options: normalizeContentWorkflowOptions(body.content_status_options, WORKFLOW_STATUS_OPTIONS),
      content_material_status_options: normalizeContentWorkflowOptions(
        body.content_material_status_options,
        MATERIAL_STATUS_OPTIONS
      ),
      content_draft_status_options: normalizeContentWorkflowOptions(
        body.content_draft_status_options,
        DRAFT_STATUS_OPTIONS
      ),
      content_final_status_options: normalizeContentWorkflowOptions(
        body.content_final_status_options,
        FINAL_STATUS_OPTIONS
      ),
    }

    if (workspaceName) {
      const { data: membership, error: membershipError } = await supabase
        .from("app_users")
        .select("role")
        .eq("user_id", userId)
        .eq("org_id", orgId)
        .maybeSingle()

      if (membershipError) {
        console.error("[api/org-settings] membership lookup failed", membershipError)
        return NextResponse.json({ ok: false, message: "認証確認に失敗しました。ログインし直してください。" }, { status: 401 })
      }

      const role = (membership as { role?: string } | null)?.role
      if (role !== "owner") {
        return NextResponse.json({ ok: false, message: "ワークスペース名を変更できるのは owner のみです。" }, { status: 403 })
      }

      const { error: orgError } = await supabase.from("organizations").update({ name: workspaceName }).eq("id", orgId)
      if (orgError) {
        console.error("[api/org-settings] organization update failed", orgError)
        return NextResponse.json({ ok: false, message: "ワークスペース名の更新に失敗しました。" }, { status: 500 })
      }
    }

    const { error } = await supabase.from("org_settings").upsert(payload, { onConflict: "org_id" })
    if (error) {
      console.error("[api/org-settings] PATCH", error)
      return NextResponse.json({ ok: false, message: "保存に失敗しました" }, { status: 500 })
    }

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (e) {
    console.error("[api/org-settings] PATCH unexpected", e)
    return NextResponse.json({ ok: false, message: "保存に失敗しました" }, { status: 500 })
  }
}
