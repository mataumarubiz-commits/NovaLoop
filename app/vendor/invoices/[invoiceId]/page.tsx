import VendorPortalClient from "@/components/vendor/VendorPortalClient"

export default async function VendorInvoiceDetailPage({
  params,
}: {
  params: Promise<{ invoiceId: string }>
}) {
  const { invoiceId } = await params
  return <VendorPortalClient mode="detail" invoiceId={invoiceId} />
}
