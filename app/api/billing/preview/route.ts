import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getOrgRole, getUserIdFromToken, isOrgAdmin } from "@/lib/apiAuth"
import { loadBillingPreview } from "@/lib/monthlyBilling"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserIdFromToken(req)
    if (!userId) {
      return NextResponse.json({ ok: false, message: "ログインし直してください。" }, { status: 401 })
    }

    const body = (await req.json().catch(() => ({}))) as { billing_month?: string; client_id?: string | null }
    const billingMonth =
      typeof body.billing_month === "string" && /^\d{4}-\d{2}$/.test(body.billing_month)
        ? body.billing_month
        : null
    if (!billingMonth) {
      return NextResponse.json({ ok: false, message: "対象月は YYYY-MM 形式で指定してください。" }, { status: 400 })
    }

    const admin = createSupabaseAdmin()
    const { data: profile } = await admin
      .from("user_profiles")
      .select("active_org_id")
      .eq("user_id", userId)
      .maybeSingle()
    const orgId = (profile as { active_org_id?: string | null } | null)?.active_org_id ?? null
    if (!orgId) {
      return NextResponse.json({ ok: false, message: "アクティブなワークスペースが見つかりません。" }, { status: 400 })
    }

    const role = await getOrgRole(admin, userId, orgId)
    if (!role) {
      return NextResponse.json({ ok: false, message: "このワークスペースに参加していません。" }, { status: 403 })
    }

    const preview = await loadBillingPreview({
      admin,
      orgId,
      billingMonth,
      clientId: typeof body.client_id === "string" && body.client_id ? body.client_id : null,
    })

    return NextResponse.json({
      ok: true,
      can_generate: isOrgAdmin(role),
      preview,
    })
  } catch (error) {
    console.error("[api/billing/preview]", error)
    return NextResponse.json({ ok: false, message: "請求プレビューの取得に失敗しました。" }, { status: 500 })
  }
}
