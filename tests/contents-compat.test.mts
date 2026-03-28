import test from "node:test"
import assert from "node:assert/strict"

const compatModuleUrl = new URL("../lib/contentsCompat.ts", import.meta.url).href
const {
  ensureContentLinksJsonRow,
  ensureContentLinksJsonRows,
  isMissingContentsLinksJsonColumn,
  removeLinksJsonFromSelect,
} = await import(compatModuleUrl)

test("removeLinksJsonFromSelect drops only the optional links_json column", () => {
  assert.equal(removeLinksJsonFromSelect("id, title, links_json, due_client_at"), "id, title, due_client_at")
})

test("isMissingContentsLinksJsonColumn detects legacy schema errors", () => {
  assert.equal(isMissingContentsLinksJsonColumn("column contents.links_json does not exist"), true)
  assert.equal(isMissingContentsLinksJsonColumn("Could not find the 'links_json' column of 'contents' in the schema cache"), true)
  assert.equal(isMissingContentsLinksJsonColumn("column contents.title does not exist"), false)
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
