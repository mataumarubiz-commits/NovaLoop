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
  const supabase = createClient(url, anonKey, { auth: { persistSession: false } })
  const {
    data: { user },
  } = await supabase.auth.getUser(token)
  return user?.id ?? null
}

/**
 * POST /api/vendor/claim
 * 招待時に付与された user_metadata.vendor_org_id / vendor_id を元に vendor_users を upsert する。
 * 冪等: 既に vendor_users がある場合は何もしない。
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await getUserIdFromToken(req)
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const admin = createSupabaseAdmin()

    // すでに vendor_users があれば何もしない
    const { data: existing } = await admin
      .from("vendor_users")
      .select("id, org_id, vendor_id")
      .eq("user_id", userId)
      .maybeSingle()
    if (existing) {
      return NextResponse.json({ success: true, orgId: (existing as { org_id: string }).org_id, vendorId: (existing as { vendor_id: string }).vendor_id })
    }

    // Auth の user_metadata から vendor 情報を取得
    const { data: userRes, error: userErr } = await admin.auth.admin.getUserById(userId)
    if (userErr || !userRes?.user) {
      return NextResponse.json({ error: "User metadata not found" }, { status: 400 })
    }
    const meta = (userRes.user.user_metadata || {}) as { vendor_org_id?: string; vendor_id?: string }
    const orgId = typeof meta.vendor_org_id === "string" ? meta.vendor_org_id : null
    const vendorId = typeof meta.vendor_id === "string" ? meta.vendor_id : null
    if (!orgId || !vendorId) {
      return NextResponse.json({ error: "招待情報が見つかりません。オーナーに確認してください。" }, { status: 400 })
    }

    // vendor_users を upsert（service role で RLS バイパス）
    const { error: upErr } = await admin
      .from("vendor_users")
      .upsert(
        {
          org_id: orgId,
          vendor_id: vendorId,
          user_id: userId,
        },
        { onConflict: "user_id" }
      )
    if (upErr) {
      return NextResponse.json({ error: upErr.message ?? "外注ユーザーの紐付けに失敗しました。" }, { status: 500 })
    }

    return NextResponse.json({ success: true, orgId, vendorId })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    )
  }
}

