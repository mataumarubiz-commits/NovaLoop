import type { Metadata } from "next"
import GoogleLoginLanding from "@/components/auth/GoogleLoginLanding"

export const metadata: Metadata = {
  title: "NovaLoop | 進行も、締めも、ここで終わる。",
  description:
    "SNS運用代行の制作進行、請求、外注支払い、運用マニュアルをひとつの画面にまとめる業務OS。",
}

export default function Page() {
  return <GoogleLoginLanding />
}