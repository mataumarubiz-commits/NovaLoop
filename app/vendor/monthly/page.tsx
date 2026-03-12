import { redirect } from "next/navigation"

export default function LegacyVendorMonthlyPage() {
  redirect("/vendor/invoices/current")
}
