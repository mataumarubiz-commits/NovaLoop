import { writeAuditLog } from "@/lib/auditLog"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"

type AdminClient = ReturnType<typeof createSupabaseAdmin>

async function safeSelect<T>(
  admin: AdminClient,
  table: string,
  columns: string,
  orgId: string,
  opts?: { whereOrgIdColumn?: string }
): Promise<T[] | null> {
  const orgColumn = opts?.whereOrgIdColumn ?? "org_id"
  try {
    const { data, error } = await admin.from(table).select(columns).eq(orgColumn, orgId)
    if (error) {
      if (error.code === "42P01" || error.message?.includes("does not exist")) return null
      throw error
    }
    return (data ?? []) as T[]
  } catch {
    return null
  }
}

type ExportJobRow = {
  id: string
  org_id: string
  created_by: string
  status: string
  file_path?: string | null
  job_type?: string | null
  trigger_source?: string | null
}

export async function queueExportJob(params: {
  admin: AdminClient
  orgId: string
  userId: string
  triggerSource?: "manual" | "cron" | "api"
}) {
  const { data, error } = await params.admin
    .from("export_jobs")
    .insert({
      org_id: params.orgId,
      created_by: params.userId,
      status: "pending",
      job_type: "full_backup",
      trigger_source: params.triggerSource ?? "manual",
      started_at: null,
      finished_at: null,
      error_message: null,
      file_path: null,
    })
    .select("id, created_at")
    .single()

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to queue export job")
  }

  return data as { id: string; created_at: string }
}

async function buildExportData(params: { admin: AdminClient; orgId: string; jobId: string }) {
  const { admin, orgId, jobId } = params

  const orgs = await safeSelect<{ id: string }>(admin, "organizations", "id, name, created_at, updated_at", orgId, {
    whereOrgIdColumn: "id",
  })

  const appUsers = await safeSelect(admin, "app_users", "user_id, org_id, role, role_id, status, display_name, created_at", orgId)
  const orgRoles = await safeSelect(admin, "org_roles", "id, org_id, key, name, is_system, permissions, sort_order, created_at", orgId)
  const orgSettings = await safeSelect(admin, "org_settings", "*", orgId)
  const integrationSettings = await safeSelect(
    admin,
    "org_integration_settings",
    "org_id, chatwork_default_room_id, auto_digest_enabled, auto_invoice_reminders_enabled, auto_backup_enabled, digest_channels, reminder_channels, backup_channels, created_at, updated_at",
    orgId
  )
  const clients = await safeSelect(admin, "clients", "id, org_id, name, client_type, entity_type, created_at", orgId)
  const projects = await safeSelect(admin, "projects", "*", orgId)
  const contents = await safeSelect(admin, "contents", "*", orgId)
  const contentTemplates = await safeSelect(admin, "content_templates", "*", orgId)
  const contentAssignments = await safeSelect(admin, "content_assignments", "*", orgId)
  const statusEvents = await safeSelect(admin, "status_events", "*", orgId)
  const pages = await safeSelect(admin, "pages", "*", orgId)
  const pageRevisions = await safeSelect(admin, "page_revisions", "*", orgId)
  const pageComments = await safeSelect(admin, "page_comments", "*", orgId)
  const invoices = await safeSelect(admin, "invoices", "*", orgId)
  const invoiceLines = await safeSelect(admin, "invoice_lines", "*", orgId, { whereOrgIdColumn: "org_id" })
  const vendors = await safeSelect(admin, "vendors", "*", orgId)
  const vendorUsers = await safeSelect(admin, "vendor_users", "*", orgId)
  const vendorInvoices = await safeSelect(admin, "vendor_invoices", "*", orgId)
  const vendorInvoiceLines = await safeSelect(admin, "vendor_invoice_lines", "*", orgId, { whereOrgIdColumn: "org_id" })
  const payouts = await safeSelect(admin, "payouts", "*", orgId)
  const expenses = await safeSelect(admin, "expenses", "*", orgId)
  const rateCards = await safeSelect(admin, "rate_cards", "*", orgId)
  const scheduleEvents = await safeSelect(admin, "schedule_events", "*", orgId)
  const projectTasks = await safeSelect(admin, "project_tasks", "*", orgId)
  const materialAssets = await safeSelect(admin, "material_assets", "*", orgId)
  const changeRequests = await safeSelect(admin, "change_requests", "*", orgId)
  const exceptions = await safeSelect(admin, "exceptions", "*", orgId)
  const reviewRounds = await safeSelect(admin, "content_review_rounds", "*", orgId)
  const reviewComments = await safeSelect(admin, "content_review_comments", "*", orgId)
  const vendorEvidence = await safeSelect(admin, "vendor_invoice_evidence_files", "*", orgId)
  const auditLogs = await safeSelect(admin, "audit_logs", "*", orgId)
  const reminderLogs = await safeSelect(admin, "invoice_reminder_logs", "*", orgId)

  const { data: orgMembers } = await admin.from("app_users").select("user_id").eq("org_id", orgId)
  const memberIds = (orgMembers ?? []).map((row) => (row as { user_id: string }).user_id)
  let notifications: Record<string, unknown>[] | null = null
  if (memberIds.length > 0) {
    const { data, error } = await admin
      .from("notifications")
      .select("id, org_id, recipient_user_id, type, payload, read_at, created_at")
      .in("recipient_user_id", memberIds)
    if (!error) {
      notifications = (data ?? []) as Record<string, unknown>[]
    }
  }

  return {
    meta: {
      org_id: orgId,
      job_id: jobId,
      exported_at: new Date().toISOString(),
      job_type: "full_backup",
    },
    organizations: orgs,
    app_users: appUsers,
    org_roles: orgRoles,
    org_settings: orgSettings,
    org_integration_settings: integrationSettings,
    clients,
    projects,
    contents,
    content_templates: contentTemplates,
    content_assignments: contentAssignments,
    status_events: statusEvents,
    pages,
    page_revisions: pageRevisions,
    page_comments: pageComments,
    invoices,
    invoice_lines: invoiceLines,
    vendors,
    vendor_users: vendorUsers,
    vendor_invoices: vendorInvoices,
    vendor_invoice_lines: vendorInvoiceLines,
    payouts,
    expenses,
    rate_cards: rateCards,
    schedule_events: scheduleEvents,
    project_tasks: projectTasks,
    material_assets: materialAssets,
    change_requests: changeRequests,
    exceptions,
    content_review_rounds: reviewRounds,
    content_review_comments: reviewComments,
    vendor_invoice_evidence_files: vendorEvidence,
    notifications,
    invoice_reminder_logs: reminderLogs,
    audit_logs: auditLogs,
  }
}

export async function processExportJob(params: { admin: AdminClient; jobId: string }) {
  const { admin, jobId } = params
  const { data: job, error: jobError } = await admin
    .from("export_jobs")
    .select("id, org_id, created_by, status, file_path, job_type, trigger_source")
    .eq("id", jobId)
    .maybeSingle()

  if (jobError || !job) {
    throw new Error(jobError?.message ?? "Export job not found")
  }

  const current = job as ExportJobRow
  if (current.status === "done" && current.file_path) {
    return {
      jobId: current.id,
      orgId: current.org_id,
      filePath: current.file_path,
      reused: true,
    }
  }
  if (current.status === "processing") {
    return {
      jobId: current.id,
      orgId: current.org_id,
      filePath: current.file_path ?? null,
      reused: false,
      processing: true,
    }
  }

  const startedAt = new Date().toISOString()
  const { error: markProcessingError } = await admin
    .from("export_jobs")
    .update({
      status: "processing",
      started_at: startedAt,
      finished_at: null,
      error_message: null,
    })
    .eq("id", current.id)
    .eq("status", current.status)

  if (markProcessingError) {
    throw new Error(markProcessingError.message)
  }

  try {
    const exportData = await buildExportData({
      admin,
      orgId: current.org_id,
      jobId: current.id,
    })
    const json = JSON.stringify(exportData, null, 2)
    const path = `org/${current.org_id}/exports/${current.id}.json`
    const { error: uploadError } = await admin.storage.from("exports").upload(path, Buffer.from(json, "utf-8"), {
      contentType: "application/json",
      upsert: true,
    })
    if (uploadError) {
      throw uploadError
    }

    const finishedAt = new Date().toISOString()
    const { error: doneError } = await admin
      .from("export_jobs")
      .update({
        status: "done",
        file_path: path,
        started_at: startedAt,
        finished_at: finishedAt,
        error_message: null,
      })
      .eq("id", current.id)

    if (doneError) {
      throw doneError
    }

    await writeAuditLog(admin, {
      org_id: current.org_id,
      user_id: current.created_by,
      action: "export.run",
      resource_type: "export",
      resource_id: current.id,
      meta: {
        file_path: path,
        job_type: current.job_type ?? "full_backup",
        trigger_source: current.trigger_source ?? "manual",
      },
    })

    return {
      jobId: current.id,
      orgId: current.org_id,
      filePath: path,
      reused: false,
      processing: false,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to process export job"
    await admin
      .from("export_jobs")
      .update({
        status: "failed",
        error_message: message,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      })
      .eq("id", current.id)
    throw new Error(message)
  }
}

export async function processPendingExportJobs(params: {
  admin: AdminClient
  limit?: number
}) {
  const { admin } = params
  const limit = Math.max(1, Math.min(10, params.limit ?? 5))
  const { data, error } = await admin
    .from("export_jobs")
    .select("id")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit)

  if (error) {
    throw new Error(error.message)
  }

  const jobs = (data ?? []) as Array<{ id: string }>
  const results = []
  for (const job of jobs) {
    try {
      results.push(await processExportJob({ admin, jobId: job.id }))
    } catch (error) {
      results.push({
        jobId: job.id,
        error: error instanceof Error ? error.message : "Failed to process export job",
      })
    }
  }
  return results
}

export async function ensureAutoBackupJobs(params: {
  admin: AdminClient
}) {
  const { admin } = params
  const { data: orgRows, error } = await admin
    .from("org_integration_settings")
    .select("org_id")
    .eq("auto_backup_enabled", true)

  if (error) {
    throw new Error(error.message)
  }

  const today = new Date().toISOString().slice(0, 10)
  const queued: string[] = []
  for (const row of (orgRows ?? []) as Array<{ org_id: string }>) {
    const { data: existing } = await admin
      .from("export_jobs")
      .select("id")
      .eq("org_id", row.org_id)
      .eq("job_type", "full_backup")
      .gte("created_at", `${today}T00:00:00.000Z`)
      .limit(1)
      .maybeSingle()

    if (existing?.id) continue
    const { data: actorRow } = await admin
      .from("app_users")
      .select("user_id")
      .eq("org_id", row.org_id)
      .in("role", ["owner", "executive_assistant"])
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle()

    const actorUserId = (actorRow as { user_id?: string | null } | null)?.user_id ?? null
    if (!actorUserId) continue
    await queueExportJob({
      admin,
      orgId: row.org_id,
      userId: actorUserId,
      triggerSource: "cron",
    })
    queued.push(row.org_id)
  }

  return queued
}
