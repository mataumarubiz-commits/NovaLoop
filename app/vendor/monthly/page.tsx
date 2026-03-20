import { redirect } from "next/navigation"

export default async function LegacyVendorMonthlyPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const { month } = await searchParams
  redirect(typeof month === "string" && month ? `/vendor/invoices/current?month=${encodeURIComponent(month)}` : "/vendor/invoices/current")
}
