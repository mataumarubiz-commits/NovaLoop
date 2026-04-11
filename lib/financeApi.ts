import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { requireAdminContext, requireOrgAdmin } from "@/lib/adminApi"

export async function requireFinanceContext(req: NextRequest, orgIdInput?: string | null) {
  if (orgIdInput && orgIdInput.trim()) {
    const auth = await requireOrgAdmin(req, orgIdInput)
    if (!auth.ok) return { ok: false as const, response: auth.response }
    return { ok: true as const, admin: auth.admin, userId: auth.userId, orgId: auth.orgId, role: auth.role }
  }

  const auth = await requireAdminContext(req)
  if ("error" in auth) return { ok: false as const, response: auth.error }
  return { ok: true as const, ...auth }
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message, message }, { status })
}
