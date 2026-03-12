import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function getUserIdFromToken(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get("Authorization")
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null
  if (!token) return null
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null
  const supabase = createClient(url, anonKey)
  const { data } = await supabase.auth.getUser(token)
  return data.user?.id ?? null
}

/**
 * POST { orgId: string }
 * オーナーのみ。組織と関連データを削除する。
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await getUserIdFromToken(req)
    if (!userId) {
      return NextResponse.json({ ok: false, message: "認証してください。" }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const orgId = typeof body?.orgId === "string" ? body.orgId.trim() : ""
    if (!orgId) {
      return NextResponse.json({ ok: false, message: "組織を指定してください。" }, { status: 400 })
    }

    const admin = createSupabaseAdmin()

    const { data: myRow } = await admin
      .from("app_users")
      .select("role")
      .eq("user_id", userId)
      .eq("org_id", orgId)
      .maybeSingle()

    const role = (myRow as { role?: string } | null)?.role
    if (role !== "owner") {
      return NextResponse.json({ ok: false, message: "組織の削除はオーナーのみ可能です。" }, { status: 403 })
    }

    const { data: invoiceIds } = await admin.from("invoices").select("id").eq("org_id", orgId)
    const ids = (invoiceIds ?? []).map((r) => (r as { id: string }).id)
    if (ids.length > 0) {
      await admin.from("invoice_lines").delete().in("invoice_id", ids)
    }

    const { data: contentIds } = await admin.from("contents").select("id").eq("org_id", orgId)
    const cIds = (contentIds ?? []).map((r) => (r as { id: string }).id)
    if (cIds.length > 0) {
      await admin.from("content_assignments").delete().in("content_id", cIds)
      await admin.from("status_events").delete().in("content_id", cIds)
    }

    await admin.from("contents").update({ invoice_id: null }).eq("org_id", orgId)
    const { data: vfRows } = await admin.from("vault_files").select("id").eq("org_id", orgId)
    const vfIds = (vfRows ?? []).map((r) => (r as { id: string }).id)
    if (vfIds.length > 0) {
      await admin.from("vault_events").delete().in("vault_file_id", vfIds)
    }
    await admin.from("vault_files").delete().eq("org_id", orgId)
    await admin.from("invoices").delete().eq("org_id", orgId)
    await admin.from("contents").delete().eq("org_id", orgId)
    await admin.from("clients").delete().eq("org_id", orgId)
    await admin.from("org_settings").delete().eq("org_id", orgId)
    await admin.from("app_users").delete().eq("org_id", orgId)
    await admin.from("join_requests").delete().eq("org_id", orgId)
    await admin.from("content_templates").delete().eq("org_id", orgId)
    await admin.from("pages").delete().eq("org_id", orgId)
    await admin.from("organizations").delete().eq("id", orgId)

    const { data: remaining } = await admin.from("app_users").select("org_id").eq("user_id", userId)
    const otherOrgId = (remaining ?? []).length > 0 ? (remaining as { org_id: string }[])[0].org_id : null
    await admin
      .from("user_profiles")
      .update({ active_org_id: otherOrgId, updated_at: new Date().toISOString() })
      .eq("user_id", userId)

    return NextResponse.json({ ok: true, activeOrgId: otherOrgId })
  } catch (e) {
    console.error("[orgs/delete]", e)
    return NextResponse.json(
      { ok: false, message: "削除に失敗しました。しばらくしてから再試行してください。" },
      { status: 500 }
    )
  }
}
