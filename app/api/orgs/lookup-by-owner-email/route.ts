import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const ownerEmail = typeof body?.ownerEmail === "string" ? body.ownerEmail.trim().toLowerCase() : ""

    if (!ownerEmail) {
      return NextResponse.json(
        { ok: false, code: "BAD_REQUEST", message: "オーナーのメールアドレスを入力してください" },
        { status: 400 }
      )
    }

    let admin
    try {
      admin = createSupabaseAdmin()
    } catch {
      return NextResponse.json(
        {
          ok: false,
          code: "SERVER_CONFIG",
          message: "この検索は管理者設定が未完了のため利用できません",
        },
        { status: 500 }
      )
    }

    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 })
    const owner = list?.users?.find((user) => user.email?.toLowerCase() === ownerEmail)

    if (!owner?.id) {
      return NextResponse.json(
        { ok: false, code: "NOT_FOUND", message: "該当するオーナーが見つかりませんでした" },
        { status: 200 }
      )
    }

    const { data: memberships } = await admin
      .from("app_users")
      .select("org_id")
      .eq("user_id", owner.id)
      .eq("role", "owner")

    if (!memberships?.length) {
      return NextResponse.json(
        { ok: false, code: "NOT_FOUND", message: "該当するオーナーのワークスペースが見つかりませんでした" },
        { status: 200 }
      )
    }

    const orgIds = memberships.map((row) => (row as { org_id: string }).org_id)
    const { data: orgs } = await admin.from("organizations").select("id, name").in("id", orgIds)

    return NextResponse.json({
      ok: true,
      ownerUserId: owner.id,
      orgs: (orgs ?? []).map((row) => ({
        id: (row as { id: string }).id,
        name: (row as { name: string }).name,
      })),
    })
  } catch (e) {
    console.error("[lookup-by-owner-email]", e)
    return NextResponse.json(
      { ok: false, code: "SERVER_ERROR", message: "ワークスペースの検索に失敗しました" },
      { status: 500 }
    )
  }
}
