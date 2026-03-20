import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase-server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"

const SIGNED_URL_EXPIRY_SEC = 3600

async function userCanAccessPath(admin: ReturnType<typeof createSupabaseAdmin>, userId: string, path: string): Promise<boolean> {
  const firstSegment = path.split("/")[0]?.trim()
  if (!firstSegment || firstSegment.length < 30) return false
  const { data } = await admin
    .from("app_users")
    .select("org_id")
    .eq("user_id", userId)
  const orgIds = (data ?? []).map((row: { org_id: string }) => row.org_id)
  return orgIds.some((orgId) => path === orgId || path.startsWith(`${orgId}/`))
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const path = searchParams.get("path")
    if (!path || typeof path !== "string") {
      return NextResponse.json({ error: "path required" }, { status: 400 })
    }
    if (path.includes("..")) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 })
    }

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const admin = createSupabaseAdmin()
    const allowed = await userCanAccessPath(admin, user.id, path)
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { data: signed, error } = await supabase.storage
      .from("project-assets")
      .createSignedUrl(path, SIGNED_URL_EXPIRY_SEC)

    if (error || !signed?.signedUrl) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    return NextResponse.redirect(signed.signedUrl, 302)
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
