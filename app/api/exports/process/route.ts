import { NextRequest, NextResponse } from "next/server"
import { requireAdminContext } from "@/lib/adminApi"
import { ensureAutoBackupJobs, processExportJob, processPendingExportJobs } from "@/lib/exportJobs"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function hasCronAccess(req: NextRequest) {
  const secret = process.env.EXPORT_JOB_CRON_SECRET || process.env.CRON_SECRET
  if (!secret) return false
  const bearer = req.headers.get("authorization")
  if (bearer === `Bearer ${secret}`) return true
  return req.headers.get("x-export-cron-secret") === secret
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminContext(req)
  if ("error" in auth) return auth.error

  const body = (await req.json().catch(() => ({}))) as {
    jobId?: string
    limit?: number
  }

  try {
    if (typeof body.jobId === "string" && body.jobId.trim()) {
      const result = await processExportJob({
        admin: auth.admin,
        jobId: body.jobId.trim(),
      })
      return NextResponse.json({ ok: true, result }, { status: 200 })
    }

    const results = await processPendingExportJobs({
      admin: auth.admin,
      limit: typeof body.limit === "number" ? body.limit : 3,
    })
    return NextResponse.json({ ok: true, results }, { status: 200 })
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Failed to process exports" },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  if (!hasCronAccess(req)) {
    return NextResponse.json({ ok: false, message: "Forbidden" }, { status: 403 })
  }

  const admin = createSupabaseAdmin()
  try {
    const queuedOrgIds = await ensureAutoBackupJobs({ admin }).catch(() => [])
    const results = await processPendingExportJobs({ admin, limit: 10 })
    return NextResponse.json({ ok: true, queuedOrgIds, results }, { status: 200 })
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Failed to process exports" },
      { status: 500 }
    )
  }
}
