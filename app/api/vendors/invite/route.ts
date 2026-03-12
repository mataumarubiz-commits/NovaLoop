import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { notifyVendorUser } from "@/lib/opsNotifications"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function getUserIdFromToken(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get("Authorization")
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null
  if (!token) return null

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null

  const supabase = createClient(url, anonKey, { auth: { persistSession: false } })
  const {
    data: { user },
  } = await supabase.auth.getUser(token)
  return user?.id ?? null
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserIdFromToken(req)
    if (!userId) return NextResponse.json({ error: "認証が必要です。" }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const vendorId = typeof body?.vendorId === "string" ? body.vendorId.trim() : ""
    const email = typeof body?.email === "string" ? body.email.trim() : ""
    if (!vendorId || !email) {
      return NextResponse.json({ error: "vendorId と email は必須です。" }, { status: 400 })
    }

    const admin = createSupabaseAdmin()
    const { data: profile } = await admin.from("user_profiles").select("active_org_id").eq("user_id", userId).maybeSingle()
    const orgId = (profile as { active_org_id?: string | null } | null)?.active_org_id ?? null
    if (!orgId) return NextResponse.json({ error: "ワークスペースを選択してください。" }, { status: 400 })

    const { data: appUser } = await admin.from("app_users").select("role").eq("user_id", userId).eq("org_id", orgId).maybeSingle()
    const role = (appUser as { role?: string } | null)?.role ?? null
    if (role !== "owner" && role !== "executive_assistant") {
      return NextResponse.json({ error: "権限がありません。" }, { status: 403 })
    }

    const { data: vend } = await admin.from("vendors").select("id, org_id, name").eq("id", vendorId).maybeSingle()
    const vendorRow = vend as { id: string; org_id: string; name?: string | null } | null
    if (!vendorRow || vendorRow.org_id !== orgId) {
      return NextResponse.json({ error: "指定した外注が見つかりません。" }, { status: 400 })
    }

    const { data: inviteRes, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      data: {
        vendor_org_id: orgId,
        vendor_id: vendorId,
      },
    })
    if (inviteErr) {
      return NextResponse.json({ error: inviteErr.message ?? "外注招待の送信に失敗しました。" }, { status: 500 })
    }

    await admin.from("vendors").update({
      email,
      vendor_portal_invited_at: new Date().toISOString(),
      vendor_portal_invited_email: email,
    }).eq("id", vendorId).eq("org_id", orgId)

    await notifyVendorUser({
      orgId,
      vendorId,
      type: "vendor_portal.invited",
      payload: {
        vendor_id: vendorId,
        vendor_name: vendorRow.name ?? "",
      },
    })

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin
    return NextResponse.json({
      success: true,
      invitedUserId: inviteRes?.user?.id ?? null,
      portalUrl: `${baseUrl}/vendor`,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "外注招待の送信に失敗しました。" },
      { status: 500 }
    )
  }
}
