import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase-server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json(
        { ok: false, message: "認証に失敗しました。ログインし直してください。" },
        { status: 401 }
      )
    }

    const body = await req.json().catch(() => ({}))
    const orgId = typeof body.org_id === "string" ? body.org_id.trim() : ""
    const name = typeof body.name === "string" ? body.name.trim() : ""

    if (!orgId || !name) {
      return NextResponse.json(
        { ok: false, message: "組織IDと名前は必須です。" },
        { status: 400 }
      )
    }

    const admin = createSupabaseAdmin()
    const { data: appUser } = await admin
      .from("app_users")
      .select("role")
      .eq("user_id", user.id)
      .eq("org_id", orgId)
      .maybeSingle()
    const role = (appUser as { role?: string } | null)?.role
    if (role !== "owner") {
      return NextResponse.json(
        { ok: false, message: "組織名の変更はオーナーのみ可能です。" },
        { status: 403 }
      )
    }

    const { error } = await supabase
      .from("organizations")
      .update({ name })
      .eq("id", orgId)

    if (error) {
      if (error.code === "42501" || error.message?.includes("policy")) {
        return NextResponse.json(
          { ok: false, message: "組織名の変更はオーナーのみ可能です。" },
          { status: 403 }
        )
      }
      console.error("[api/org] update failed", error)
      return NextResponse.json(
        { ok: false, message: "保存に失敗しました。しばらくしてから再試行してください。" },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (e) {
    console.error("[api/org] unexpected error", e)
    return NextResponse.json(
      { ok: false, message: "保存に失敗しました。しばらくしてから再試行してください。" },
      { status: 500 }
    )
  }
}
