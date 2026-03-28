import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import type { User } from "@supabase/supabase-js"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { createUserClient, getBearerToken } from "@/lib/userClient"

export type PlatformUserAuth = {
  userClient: NonNullable<ReturnType<typeof createUserClient>>
  token: string
  user: User
}

export type PlatformAdminAuth = PlatformUserAuth & {
  admin: ReturnType<typeof createSupabaseAdmin>
}

export async function requirePlatformUser(req: NextRequest): Promise<PlatformUserAuth | { error: NextResponse }> {
  const token = getBearerToken(req)
  if (!token) {
    return { error: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }) }
  }

  const supabase = createUserClient(token)
  if (!supabase) {
    return { error: NextResponse.json({ ok: false, error: "Supabase client is not configured" }, { status: 500 }) }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser(token)

  if (!user) {
    return { error: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }) }
  }

  return {
    userClient: supabase,
    token,
    user,
  }
}

export async function requirePlatformAdmin(req: NextRequest): Promise<PlatformAdminAuth | { error: NextResponse }> {
  const auth = await requirePlatformUser(req)
  if ("error" in auth) return auth

  const admin = createSupabaseAdmin()
  const { data: row } = await admin.from("platform_admins").select("user_id").eq("user_id", auth.user.id).maybeSingle()
  if (!row) {
    return { error: NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 }) }
  }

  return {
    ...auth,
    admin,
  } satisfies PlatformAdminAuth
}
