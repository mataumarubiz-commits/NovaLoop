import test from "node:test"
import assert from "node:assert/strict"
import { buildInvoiceNo, planInvoiceIssue } from "../lib/invoiceIssuance.ts"

test("buildInvoiceNo formats the current sequence with zero padding", () => {
  assert.equal(buildInvoiceNo("2026-04-10", 42), "INV-2026-0000042")
})

test("planInvoiceIssue assigns numbers only to drafts without invoice numbers", () => {
  const { updates, nextSeq } = planInvoiceIssue({
    initialSeq: 8,
    nowIso: "2026-04-10T09:30:00.000Z",
    invoices: [
      {
        id: "draft-a",
        status: "draft",
        invoice_no: null,
        issue_date: "2026-04-10",
        issued_at: null,
      },
      {
        id: "issued-b",
        status: "issued",
        invoice_no: "INV-2026-0000007",
        issue_date: "2026-04-09",
        issued_at: "2026-04-09T00:00:00.000Z",
      },
      {
        id: "draft-c",
        status: "draft",
        invoice_no: null,
        issue_date: null,
        issued_at: null,
      },
    ],
  })

  assert.equal(nextSeq, 10)
  assert.deepEqual(
    updates.map((update) => ({
      invoiceId: update.invoiceId,
      invoiceNo: update.invoiceNo,
      issueDate: update.issueDate,
      assignedNewNumber: update.assignedNewNumber,
    })),
    [
      {
        invoiceId: "draft-a",
        invoiceNo: "INV-2026-0000008",
        issueDate: "2026-04-10",
        assignedNewNumber: true,
      },
      {
        invoiceId: "issued-b",
        invoiceNo: "INV-2026-0000007",
        issueDate: "2026-04-09",
        assignedNewNumber: false,
      },
      {
        invoiceId: "draft-c",
        invoiceNo: "INV-2026-0000009",
        issueDate: "2026-04-10",
        assignedNewNumber: true,
      },
    ]
  )
  assert.equal(updates[1]?.needsUpdate, false)
})

test("planInvoiceIssue rejects void invoices", () => {
  assert.throws(
    () =>
      planInvoiceIssue({
        initialSeq: 1,
        invoices: [
          {
            id: "voided",
            status: "void",
            invoice_no: null,
            issue_date: null,
            issued_at: null,
          },
        ],
      }),
    /無効化された請求書/
  )
})
