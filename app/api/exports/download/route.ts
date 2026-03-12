import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getUserIdFromToken, getOrgRole, isOrgAdmin } from "@/lib/apiAuth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    const userId = await getUserIdFromToken(req)
    if (!userId) {
      return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 })
    }

    const jobId = req.nextUrl.searchParams.get("jobId")?.trim() ?? ""
    if (!jobId) {
      return NextResponse.json({ ok: false, message: "jobId is required" }, { status: 400 })
    }
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    if (!uuidRe.test(jobId)) {
      return NextResponse.json({ ok: false, message: "Invalid jobId" }, { status: 400 })
    }

    const admin = createSupabaseAdmin()
    const { data: job, error: jobErr } = await admin
      .from("export_jobs")
      .select("id, org_id, status, file_path")
      .eq("id", jobId)
      .maybeSingle()

    if (jobErr || !job) {
      return NextResponse.json({ ok: false, message: "Export job not found" }, { status: 404 })
    }

    const row = job as { org_id: string; status: string; file_path: string | null }
    if (row.status !== "done" || !row.file_path) {
      return NextResponse.json({ ok: false, message: "Export is not ready" }, { status: 400 })
    }

    const callerRole = await getOrgRole(admin, userId, row.org_id)
    if (!isOrgAdmin(callerRole)) {
      return NextResponse.json({ ok: false, message: "Forbidden" }, { status: 403 })
    }

    const { data: signed, error: signErr } = await admin.storage
      .from("exports")
      .createSignedUrl(row.file_path, 60 * 5)

    if (signErr || !signed?.signedUrl) {
      return NextResponse.json(
        { ok: false, message: signErr?.message ?? "Failed to create signed URL" },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true, url: signed.signedUrl })
  } catch (e) {
    return NextResponse.json(
      { ok: false, message: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    )
  }
}

