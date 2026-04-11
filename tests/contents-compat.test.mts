import test from "node:test"
import assert from "node:assert/strict"

const compatModuleUrl = new URL("../lib/contentsCompat.ts", import.meta.url).href
const {
  ensureContentLinksJsonRow,
  ensureContentLinksJsonRows,
  isMissingContentsLinksJsonColumn,
  isMissingContentsWorkItemFieldsColumn,
  removeLinksJsonFromSelect,
  removeWorkItemFieldsFromSelect,
  sanitizeContentWritePayload,
} = await import(compatModuleUrl)

test("removeLinksJsonFromSelect drops only the optional links_json column", () => {
  assert.equal(removeLinksJsonFromSelect("id, title, links_json, due_client_at"), "id, title, due_client_at")
})

test("removeWorkItemFieldsFromSelect drops only legacy optional work item columns", () => {
  assert.equal(
    removeWorkItemFieldsFromSelect(
      "id, title, workload_points, estimated_cost, next_action, blocked_reason, material_status, draft_status, final_status, health_score, due_client_at"
    ),
    "id, title, due_client_at"
  )
})

test("isMissingContentsLinksJsonColumn detects legacy schema errors", () => {
  assert.equal(isMissingContentsLinksJsonColumn("column contents.links_json does not exist"), true)
  assert.equal(isMissingContentsLinksJsonColumn("Could not find the 'links_json' column of 'contents' in the schema cache"), true)
  assert.equal(isMissingContentsLinksJsonColumn("column contents.title does not exist"), false)
})

test("isMissingContentsWorkItemFieldsColumn detects legacy schema errors", () => {
  assert.equal(isMissingContentsWorkItemFieldsColumn("column contents.health_score does not exist"), true)
  assert.equal(
    isMissingContentsWorkItemFieldsColumn("Could not find the 'material_status' column of 'contents' in the schema cache"),
    true
  )
  assert.equal(isMissingContentsWorkItemFieldsColumn("column contents.title does not exist"), false)
})

test("ensureContentLinksJson helpers backfill an empty links_json object", () => {
  assert.deepEqual(ensureContentLinksJsonRow({ id: "c1", title: "Test" }).links_json, {})
  assert.deepEqual(
    ensureContentLinksJsonRows([{ id: "c1" }, { id: "c2", links_json: { brief: "https://example.com" } }]).map(
      (row: { links_json: unknown }) => row.links_json
    ),
    [{}, { brief: "https://example.com" }]
  )
})

test("sanitizeContentWritePayload drops only unsupported optional content fields", () => {
  const payload = {
    id: "c1",
    title: "Test",
    links_json: { brief: "https://example.com" },
    workload_points: 1,
    estimated_cost: 1000,
    health_score: 90,
    due_client_at: "2026-04-08",
  }

  assert.deepEqual(
    sanitizeContentWritePayload(payload, {
      supportsLinksJson: false,
      supportsWorkItemFields: true,
    }),
    {
      id: "c1",
      title: "Test",
      workload_points: 1,
      estimated_cost: 1000,
      health_score: 90,
      due_client_at: "2026-04-08",
    }
  )

  assert.deepEqual(
    sanitizeContentWritePayload(payload, {
      supportsLinksJson: true,
      supportsWorkItemFields: false,
    }),
    {
      id: "c1",
      title: "Test",
      links_json: { brief: "https://example.com" },
      due_client_at: "2026-04-08",
    }
  )
})
