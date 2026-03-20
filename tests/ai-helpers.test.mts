import assert from "node:assert/strict"
import { createRequire } from "node:module"
import test from "node:test"

const require = createRequire(import.meta.url)
const { buildSystemPrompt, kindForMode, trimForLog, isAdminOnlyMode } = require("../lib/ai/internalText.ts")
const { parseAiHistorySearchParams } = require("../lib/ai/historyFilters.ts")
const { buildLineQuickReplyItems, mapDiscordButtonPrompt, normalizeLineQuickReplyTexts } = require("../lib/ai/externalUi.ts")

test("buildSystemPrompt appends additional instruction for text modes", () => {
  const prompt = buildSystemPrompt("title_ideas", "5案ではなく3案")
  assert.match(prompt, /title candidates/i)
  assert.match(prompt, /Additional instruction: 5案ではなく3案/)
})

test("kindForMode groups proposal snippet and draft modes", () => {
  assert.equal(kindForMode("request_title"), "proposal")
  assert.equal(kindForMode("status_summary"), "snippet")
  assert.equal(kindForMode("rewrite"), "draft")
})

test("trimForLog trims empty strings and clamps long output", () => {
  assert.equal(trimForLog("   ", 10), null)
  assert.equal(trimForLog(" abc ", 10), "abc")
  assert.equal(trimForLog("12345678901", 10), "1234567890...")
})

test("isAdminOnlyMode flags operator-only AI modes", () => {
  assert.equal(isAdminOnlyMode("rewrite"), true)
  assert.equal(isAdminOnlyMode("summarize"), false)
})

test("parseAiHistorySearchParams validates source mode and limit", () => {
  const filters = parseAiHistorySearchParams(
    new URLSearchParams({
      source: "contents",
      mode: "title_ideas",
      applyTarget: "contents_detail_title",
      recordId: "row-1",
      sourceObject: "content",
      limit: "99",
    })
  )

  assert.deepEqual(filters, {
    source: "contents",
    mode: "title_ideas",
    applyTarget: "contents_detail_title",
    recordId: "row-1",
    sourceObject: "content",
    limit: 10,
  })
})

test("parseAiHistorySearchParams drops invalid filters", () => {
  const filters = parseAiHistorySearchParams(
    new URLSearchParams({
      source: "unknown",
      mode: "bad_mode",
      limit: "-3",
    })
  )

  assert.equal(filters.source, null)
  assert.equal(filters.mode, null)
  assert.equal(filters.limit, 1)
})

test("LINE quick replies are deduplicated and capped", () => {
  assert.deepEqual(
    normalizeLineQuickReplyTexts([" 請求を見せて ", "請求を見せて", "遅延だけ見せて", "通知を見せて", "手順を見せて", "追加"], 4),
    ["請求を見せて", "遅延だけ見せて", "通知を見せて", "手順を見せて"]
  )
})

test("buildLineQuickReplyItems creates message actions", () => {
  const items = buildLineQuickReplyItems(["請求を見せて", "遅延だけ見せて"])
  assert.equal(items.length, 2)
  assert.deepEqual(items[0], {
    type: "action",
    action: {
      type: "message",
      label: "請求を見せて",
      text: "請求を見せて",
    },
  })
})

test("mapDiscordButtonPrompt returns stable prompts", () => {
  assert.equal(mapDiscordButtonPrompt("nova_refresh:billing"), "今の請求状況を教えて")
  assert.equal(mapDiscordButtonPrompt("filter_unsubmitted_vendor"), "未提出の外注請求だけ見せて")
  assert.equal(mapDiscordButtonPrompt("unknown"), null)
})
