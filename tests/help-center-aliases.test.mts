import test from "node:test"
import assert from "node:assert/strict"

const helpCenterModuleUrl = new URL("../lib/helpCenter.ts", import.meta.url).href
const { HELP_ARTICLES, HELP_SLUG_ALIASES, resolveHelpSlug } = await import(helpCenterModuleUrl)

test("help slug aliases resolve to existing articles", () => {
  const articleSlugs = new Set(HELP_ARTICLES.map((article: { slug: string }) => article.slug))
  for (const [legacySlug, canonicalSlug] of Object.entries(HELP_SLUG_ALIASES as Record<string, string>)) {
    assert.equal(resolveHelpSlug(legacySlug), canonicalSlug)
    assert.equal(
      articleSlugs.has(canonicalSlug),
      true,
      `expected alias ${legacySlug} to resolve to an existing article slug`
    )
  }
})

test("canonical help slugs pass through unchanged", () => {
  assert.equal(resolveHelpSlug("projects-daily"), "projects-daily")
  assert.equal(resolveHelpSlug("billing-monthly"), "billing-monthly")
})
