"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"

type ChecklistReturnButtonProps = {
  href?: string
  label?: string
}

export default function ChecklistReturnButton({
  href = "/home?panel=checklist",
  label = "チェックリストに戻る",
}: ChecklistReturnButtonProps) {
  const searchParams = useSearchParams()

  if (searchParams.get("from") !== "checklist") return null

  return (
    <Link
      href={href}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "12px 16px",
        borderRadius: 12,
        background: "#111111",
        color: "#ffffff",
        textDecoration: "none",
        fontSize: 14,
        fontWeight: 700,
        boxShadow: "0 12px 24px rgba(15, 23, 42, 0.16)",
      }}
    >
      <span aria-hidden="true">←</span>
      <span>{label}</span>
    </Link>
  )
}
