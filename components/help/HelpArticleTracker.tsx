"use client"

import { useEffect } from "react"
import { trackClientEvent } from "@/lib/analytics"

export default function HelpArticleTracker({ slug }: { slug: string }) {
  useEffect(() => {
    void trackClientEvent("help.article_viewed", {
      source: "help_article",
      entityType: "help_article",
      entityId: slug,
      metadata: { slug },
    })
  }, [slug])

  return null
}
