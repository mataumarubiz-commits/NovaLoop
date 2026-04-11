import type { SupabaseClient } from "@supabase/supabase-js"
import { assertTargetMonth, nextMonthPaymentDate } from "@/lib/monthCloseAutomation"

type TransferPreviewItem = {
  payoutId: string
  vendorInvoiceId: string | null
  vendorId: string
  vendorName: string
  payDate: string
  amount: number
  status: string
  bankReady: boolean
  warning: string | null
  vendorBankAccountId: string | null
  beneficiarySnapshot: Record<string, unknown>
}

function safeNumber(value: unknown): number {
  const num = Number(value ?? 0)
  return Number.isFinite(num) ? num : 0
}

function ymFromDate(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 7) : ""
}

function buildIdempotencyKey(prefix: string, parts: Array<string | null | undefined>) {
  return [prefix, ...parts.map((part) => String(part ?? "none"))].join(":")
}

async function getDefaultBankAccounts(admin: SupabaseClient, orgId: string, vendorIds: string[]) {
  if (vendorIds.length === 0) return new Map<string, Record<string, unknown>>()
  const { data } = await admin
    .from("vendor_bank_accounts")
    .select("id, vendor_id, bank_name, branch_name, account_type, account_number, account_holder, is_default")
    .eq("org_id", orgId)
    .in("vendor_id", vendorIds)
    .eq("is_default", true)

  return new Map(((data ?? []) as Array<Record<string, unknown>>).map((row) => [String(row.vendor_id), row]))
}

async function ensurePayoutsForVendorInvoices(params: {
  admin: SupabaseClient
  orgId: string
  targetMonth: string
  vendorInvoiceIds?: string[]
}) {
  const { admin, orgId, targetMonth, vendorInvoiceIds } = params
  let query = admin
    .from("vendor_invoices")
    .select("id, vendor_id, billing_month, target_month, status, pay_date, total, total_amount")
    .eq("org_id", orgId)
    .in("status", ["approved", "payout_generated"])

  if (vendorInvoiceIds && vendorInvoiceIds.length > 0) {
    query = query.in("id", vendorInvoiceIds)
  } else {
    query = query.eq("billing_month", targetMonth)
  }

  const { data, error } = await query
  if (error) throw new Error(error.message)

  const invoices = (((data ?? []) as Array<Record<string, unknown>>) || []).filter((row) => {
    const month = typeof row.target_month === "string" ? row.target_month : row.billing_month
    return month === targetMonth
  })

  const created: string[] = []
  for (const invoice of invoices) {
    const { data: existing } = await admin
      .from("payouts")
      .select("id")
      .eq("org_id", orgId)
      .eq("vendor_invoice_id", invoice.id)
      .maybeSingle()
    if (existing) continue

    const payoutId = crypto.randomUUID()
    const { error: insertError } = await admin.from("payouts").insert({
      id: payoutId,
      org_id: orgId,
      vendor_id: invoice.vendor_id,
      vendor_invoice_id: invoice.id,
      target_month: targetMonth,
      pay_date: invoice.pay_date ?? nextMonthPaymentDate(targetMonth),
      amount: safeNumber(invoice.total_amount ?? invoice.total),
      status: "scheduled",
    })
    if (insertError) throw new Error(insertError.message)
    created.push(payoutId)
  }
  return created
}

export async function previewTransferBatch(params: {
  admin: SupabaseClient
  orgId: string
  targetMonth: string
  vendorInvoiceIds?: string[]
  payoutIds?: string[]
}) {
  const { admin, orgId, targetMonth, vendorInvoiceIds, payoutIds } = params
  assertTargetMonth(targetMonth)
  await ensurePayoutsForVendorInvoices({ admin, orgId, targetMonth, vendorInvoiceIds })

  let query = admin
    .from("payouts")
    .select("id, vendor_id, vendor_invoice_id, target_month, pay_date, amount, status")
    .eq("org_id", orgId)
    .in("status", ["draft", "scheduled", "approval_pending", "approved", "failed"])

  if (payoutIds && payoutIds.length > 0) {
    query = query.in("id", payoutIds)
  } else {
    query = query.eq("target_month", targetMonth)
  }

  const { data: payoutRows, error: payoutError } = await query
  if (payoutError) throw new Error(payoutError.message)

  const payouts = (((payoutRows ?? []) as Array<Record<string, unknown>>) || []).filter((row) => {
    const month = typeof row.target_month === "string" ? row.target_month : ymFromDate(row.pay_date)
    return month === targetMonth
  })
  const vendorIds = Array.from(new Set(payouts.map((row) => String(row.vendor_id)).filter(Boolean)))
  const [{ data: vendorRows, error: vendorError }, bankMap] = await Promise.all([
    vendorIds.length > 0
      ? admin
          .from("vendors")
          .select("id, name, bank_name, bank_branch, bank_account_type, bank_account_number, bank_account_holder, bank_account_holder_kana")
          .eq("org_id", orgId)
          .in("id", vendorIds)
      : Promise.resolve({ data: [], error: null }),
    getDefaultBankAccounts(admin, orgId, vendorIds),
  ])
  if (vendorError) throw new Error(vendorError.message)

  const vendorMap = new Map(((vendorRows ?? []) as Array<Record<string, unknown>>).map((row) => [String(row.id), row]))
  const items: TransferPreviewItem[] = payouts.map((payout) => {
    const vendor = vendorMap.get(String(payout.vendor_id)) ?? {}
    const bank = bankMap.get(String(payout.vendor_id)) ?? null
    const bankName = String(bank?.bank_name ?? vendor.bank_name ?? "")
    const branchName = String(bank?.branch_name ?? vendor.bank_branch ?? "")
    const accountType = String(bank?.account_type ?? vendor.bank_account_type ?? "")
    const accountNumber = String(bank?.account_number ?? vendor.bank_account_number ?? "")
    const accountHolder = String(bank?.account_holder ?? vendor.bank_account_holder_kana ?? vendor.bank_account_holder ?? "")
    const missing = [
      !bankName && "bank_name",
      !branchName && "branch_name",
      !accountType && "account_type",
      !accountNumber && "account_number",
      !accountHolder && "account_holder",
      safeNumber(payout.amount) <= 0 && "amount",
    ].filter(Boolean)

    return {
      payoutId: String(payout.id),
      vendorInvoiceId: payout.vendor_invoice_id ? String(payout.vendor_invoice_id) : null,
      vendorId: String(payout.vendor_id),
      vendorName: String(vendor.name ?? payout.vendor_id),
      payDate: String(payout.pay_date ?? ""),
      amount: safeNumber(payout.amount),
      status: String(payout.status ?? ""),
      bankReady: missing.length === 0,
      warning: missing.length > 0 ? `missing: ${missing.join(", ")}` : null,
      vendorBankAccountId: bank?.id ? String(bank.id) : null,
      beneficiarySnapshot: {
        vendor_name: vendor.name ?? null,
        bank_name: bankName,
        branch_name: branchName,
        account_type: accountType,
        account_number_masked: accountNumber ? `***${accountNumber.slice(-4)}` : "",
        account_holder: accountHolder,
      },
    }
  })

  return {
    ok: true,
    targetMonth,
    count: items.length,
    executableCount: items.filter((item) => item.bankReady).length,
    warningCount: items.filter((item) => item.warning).length,
    totalAmount: items.reduce((sum, item) => sum + item.amount, 0),
    items,
  }
}

export async function createTransferBatch(params: {
  admin: SupabaseClient
  orgId: string
  targetMonth: string
  userId: string
  vendorInvoiceIds?: string[]
  payoutIds?: string[]
  provider?: string
}) {
  const { admin, orgId, targetMonth, vendorInvoiceIds, payoutIds, provider = "manual" } = params
  const preview = await previewTransferBatch({ admin, orgId, targetMonth, vendorInvoiceIds, payoutIds })
  const executableItems = preview.items.filter((item) => item.bankReady && item.amount > 0)
  if (executableItems.length === 0) {
    return { ok: false, status: "blocked", message: "No executable payouts", preview }
  }

  const idempotencyKey = buildIdempotencyKey(
    "transfer_batch",
    [orgId, targetMonth, ...executableItems.map((item) => item.payoutId).sort()]
  )
  const totalAmount = executableItems.reduce((sum, item) => sum + item.amount, 0)

  const { data: existing } = await admin
    .from("transfer_batches")
    .select("id, status")
    .eq("org_id", orgId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle()

  if (existing) {
    return { ok: true, batchId: (existing as { id: string }).id, reused: true, preview }
  }

  const { data: batch, error: batchError } = await admin
    .from("transfer_batches")
    .insert({
      org_id: orgId,
      target_month: targetMonth,
      total_count: executableItems.length,
      total_amount: totalAmount,
      status: "draft",
      provider,
      idempotency_key: idempotencyKey,
    })
    .select("id")
    .maybeSingle()
  if (batchError) throw new Error(batchError.message)
  const batchId = (batch as { id?: string } | null)?.id
  if (!batchId) throw new Error("transfer batch id was not returned")

  const transferRows = executableItems.map((item) => ({
    org_id: orgId,
    transfer_batch_id: batchId,
    payout_id: item.payoutId,
    vendor_bank_account_id: item.vendorBankAccountId,
    provider,
    idempotency_key: buildIdempotencyKey("transfer", [batchId, item.payoutId]),
    status: "queued",
    amount: item.amount,
    beneficiary_snapshot: item.beneficiarySnapshot,
  }))
  const { error: transferError } = await admin.from("transfers").insert(transferRows)
  if (transferError) throw new Error(transferError.message)

  await admin
    .from("payouts")
    .update({ status: "approval_pending" })
    .eq("org_id", orgId)
    .in("id", executableItems.map((item) => item.payoutId))

  return { ok: true, batchId, reused: false, preview }
}

export async function approveTransferBatchStage1(params: {
  admin: SupabaseClient
  orgId: string
  batchId: string
  userId: string
}) {
  const { admin, orgId, batchId, userId } = params
  const now = new Date().toISOString()
  const { data: batch, error: batchError } = await admin
    .from("transfer_batches")
    .select("id, status")
    .eq("org_id", orgId)
    .eq("id", batchId)
    .maybeSingle()
  if (batchError) throw new Error(batchError.message)
  if (!batch) throw new Error("transfer batch not found")

  const { error: updateError } = await admin
    .from("transfer_batches")
    .update({ status: "approved", approved_by_user_id: userId, approved_at: now })
    .eq("org_id", orgId)
    .eq("id", batchId)
  if (updateError) throw new Error(updateError.message)

  await admin.from("payout_batch_approvals").upsert(
    {
      org_id: orgId,
      transfer_batch_id: batchId,
      stage: 1,
      actor_user_id: userId,
      action: "approve",
    },
    { onConflict: "transfer_batch_id,stage,actor_user_id,action" }
  )

  const { data: transferRows } = await admin
    .from("transfers")
    .select("payout_id")
    .eq("org_id", orgId)
    .eq("transfer_batch_id", batchId)
  const payoutIds = ((transferRows ?? []) as Array<{ payout_id?: string }>).map((row) => row.payout_id).filter(Boolean) as string[]
  if (payoutIds.length > 0) {
    await admin.from("payouts").update({ status: "approved", approved_at: now }).eq("org_id", orgId).in("id", payoutIds)
  }

  return { ok: true, status: "approved", batchId }
}

export async function executeTransferBatchStage2(params: {
  admin: SupabaseClient
  orgId: string
  batchId: string
  userId: string
  provider?: string
}) {
  const { admin, orgId, batchId, userId, provider = "manual" } = params
  const now = new Date().toISOString()
  const { data: batch, error: batchError } = await admin
    .from("transfer_batches")
    .select("id, status, provider")
    .eq("org_id", orgId)
    .eq("id", batchId)
    .maybeSingle()
  if (batchError) throw new Error(batchError.message)
  if (!batch) throw new Error("transfer batch not found")
  const status = String((batch as { status?: string }).status ?? "")
  if (status !== "approved" && status !== "processing" && status !== "failed") {
    return { ok: false, status, message: "stage1 approval is required before execution" }
  }

  const adapterMode = process.env.TRANSFER_PROVIDER_MODE ?? provider
  if (adapterMode !== "manual" && adapterMode !== "manual_mock") {
    const message = `Transfer provider ${adapterMode} is not configured`
    await admin
      .from("transfer_batches")
      .update({ status: "failed", last_error: message, executed_by_user_id: userId, executed_at: now })
      .eq("org_id", orgId)
      .eq("id", batchId)
    return { ok: false, status: "failed", message }
  }

  const { data: transfers, error: transfersError } = await admin
    .from("transfers")
    .select("id, payout_id, amount")
    .eq("org_id", orgId)
    .eq("transfer_batch_id", batchId)
  if (transfersError) throw new Error(transfersError.message)
  const transferRows = ((transfers ?? []) as Array<Record<string, unknown>>) || []

  await admin
    .from("transfer_batches")
    .update({ status: "processing", executed_by_user_id: userId, executed_at: now, last_error: null })
    .eq("org_id", orgId)
    .eq("id", batchId)

  if (transferRows.length > 0) {
    await admin
      .from("transfers")
      .update({ status: "succeeded", processed_at: now, provider_transfer_id: null })
      .eq("org_id", orgId)
      .eq("transfer_batch_id", batchId)
    await admin
      .from("payouts")
      .update({ status: "paid", paid_at: now })
      .eq("org_id", orgId)
      .in("id", transferRows.map((row) => String(row.payout_id)))
  }

  await admin
    .from("transfer_batches")
    .update({ status: "succeeded", executed_by_user_id: userId, executed_at: now, last_error: null })
    .eq("org_id", orgId)
    .eq("id", batchId)

  await admin.from("payout_batch_approvals").upsert(
    {
      org_id: orgId,
      transfer_batch_id: batchId,
      stage: 2,
      actor_user_id: userId,
      action: "execute",
    },
    { onConflict: "transfer_batch_id,stage,actor_user_id,action" }
  )

  return {
    ok: true,
    status: "succeeded",
    batchId,
    succeededCount: transferRows.length,
    failedCount: 0,
  }
}

export async function loadTransferBatchStatus(params: {
  admin: SupabaseClient
  orgId: string
  batchId: string
}) {
  const { admin, orgId, batchId } = params
  const [{ data: batch, error: batchError }, { data: transfers, error: transfersError }] = await Promise.all([
    admin.from("transfer_batches").select("*").eq("org_id", orgId).eq("id", batchId).maybeSingle(),
    admin.from("transfers").select("*").eq("org_id", orgId).eq("transfer_batch_id", batchId),
  ])
  if (batchError) throw new Error(batchError.message)
  if (transfersError) throw new Error(transfersError.message)
  if (!batch) throw new Error("transfer batch not found")
  const transferRows = ((transfers ?? []) as Array<Record<string, unknown>>) || []
  return {
    ok: true,
    batch,
    transfers: transferRows,
    summary: {
      count: transferRows.length,
      succeeded: transferRows.filter((row) => row.status === "succeeded").length,
      failed: transferRows.filter((row) => row.status === "failed").length,
      queued: transferRows.filter((row) => row.status === "queued").length,
    },
  }
}

export async function retryFailedTransferBatch(params: {
  admin: SupabaseClient
  orgId: string
  batchId: string
  userId: string
}) {
  const { admin, orgId, batchId, userId } = params
  const { data: failedTransfers, error } = await admin
    .from("transfers")
    .select("id, payout_id")
    .eq("org_id", orgId)
    .eq("transfer_batch_id", batchId)
    .eq("status", "failed")

  if (error) throw new Error(error.message)
  const rows = ((failedTransfers ?? []) as Array<Record<string, unknown>>) || []
  if (rows.length === 0) {
    return { ok: true, batchId, retriedCount: 0, status: "no_failed_transfers" }
  }

  await admin
    .from("transfers")
    .update({ status: "queued", failure_code: null, failure_message: null, failed_at: null })
    .eq("org_id", orgId)
    .eq("transfer_batch_id", batchId)
    .eq("status", "failed")

  const payoutIds = rows.map((row) => String(row.payout_id)).filter(Boolean)
  if (payoutIds.length > 0) {
    await admin.from("payouts").update({ status: "approved" }).eq("org_id", orgId).in("id", payoutIds)
  }

  await admin
    .from("transfer_batches")
    .update({ status: "approved", last_error: null })
    .eq("org_id", orgId)
    .eq("id", batchId)

  return executeTransferBatchStage2({ admin, orgId, batchId, userId })
}

export async function recordTransferWebhook(params: {
  admin: SupabaseClient
  provider: string
  providerTransferId?: string | null
  idempotencyKey?: string | null
  status: string
  failureCode?: string | null
  failureMessage?: string | null
  payload: Record<string, unknown>
}) {
  const { admin, provider, providerTransferId, idempotencyKey, status, failureCode, failureMessage, payload } = params
  if (!providerTransferId && !idempotencyKey) {
    return { ok: false, message: "providerTransferId or idempotencyKey is required" }
  }

  let query = admin.from("transfers").select("id, org_id, payout_id, transfer_batch_id").eq("provider", provider)
  if (providerTransferId) {
    query = query.eq("provider_transfer_id", providerTransferId)
  } else if (idempotencyKey) {
    query = query.eq("idempotency_key", idempotencyKey)
  }

  const { data: transfer, error } = await query.maybeSingle()
  if (error) throw new Error(error.message)
  if (!transfer) return { ok: false, message: "transfer not found" }

  const now = new Date().toISOString()
  const nextStatus =
    status === "succeeded" || status === "paid" || status === "completed"
      ? "succeeded"
      : status === "failed" || status === "error"
        ? "failed"
        : status === "reversed"
          ? "reversed"
          : "processing"
  const transferRow = transfer as { id: string; org_id: string; payout_id: string; transfer_batch_id: string }

  await admin
    .from("transfers")
    .update({
      status: nextStatus,
      provider_transfer_id: providerTransferId ?? null,
      processed_at: nextStatus === "succeeded" ? now : null,
      failed_at: nextStatus === "failed" ? now : null,
      failure_code: failureCode ?? null,
      failure_message: failureMessage ?? null,
      beneficiary_snapshot: {
        ...(payload.beneficiary_snapshot && typeof payload.beneficiary_snapshot === "object"
          ? (payload.beneficiary_snapshot as Record<string, unknown>)
          : {}),
        webhook_payload: payload,
      },
    })
    .eq("id", transferRow.id)

  if (nextStatus === "succeeded") {
    await admin
      .from("payouts")
      .update({ status: "paid", paid_at: now })
      .eq("org_id", transferRow.org_id)
      .eq("id", transferRow.payout_id)
  } else if (nextStatus === "failed") {
    await admin.from("payouts").update({ status: "failed" }).eq("org_id", transferRow.org_id).eq("id", transferRow.payout_id)
  } else if (nextStatus === "reversed") {
    await admin.from("payouts").update({ status: "reversed" }).eq("org_id", transferRow.org_id).eq("id", transferRow.payout_id)
  }

  const { data: batchTransfers } = await admin
    .from("transfers")
    .select("status")
    .eq("org_id", transferRow.org_id)
    .eq("transfer_batch_id", transferRow.transfer_batch_id)
  const statuses = ((batchTransfers ?? []) as Array<{ status?: string }>).map((row) => row.status)
  const batchStatus =
    statuses.length > 0 && statuses.every((value) => value === "succeeded")
      ? "succeeded"
      : statuses.some((value) => value === "failed")
        ? statuses.some((value) => value === "succeeded")
          ? "partial_success"
          : "failed"
        : "processing"

  await admin
    .from("transfer_batches")
    .update({ status: batchStatus, last_error: nextStatus === "failed" ? failureMessage ?? failureCode ?? "transfer failed" : null })
    .eq("org_id", transferRow.org_id)
    .eq("id", transferRow.transfer_batch_id)

  return { ok: true, transferId: transferRow.id, batchId: transferRow.transfer_batch_id, status: nextStatus, batchStatus }
}

export async function buildTransferReverseGuide(params: {
  admin: SupabaseClient
  orgId: string
  batchId: string
}) {
  const status = await loadTransferBatchStatus(params)
  const transfers = (status.transfers as Array<Record<string, unknown>>) || []
  return {
    ok: true,
    batchId: params.batchId,
    message: "Automatic reversal is not executed by NovaLoop. Use this guide to reverse or correct transfers with the bank/provider, then record the final payout state.",
    steps: [
      "Confirm the provider transfer id and beneficiary for the affected transfer.",
      "Use the bank/provider console to request reversal or create a correcting transfer.",
      "Update the payout status only after the provider confirms the result.",
      "Keep the provider receipt or incident note as monthly close evidence.",
    ],
    transfers: transfers.map((row) => ({
      id: row.id,
      payout_id: row.payout_id,
      provider: row.provider,
      provider_transfer_id: row.provider_transfer_id,
      status: row.status,
      amount: row.amount,
      failure_code: row.failure_code,
      failure_message: row.failure_message,
    })),
  }
}
