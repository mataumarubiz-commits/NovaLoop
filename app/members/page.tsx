import { redirect } from "next/navigation"

export default function MembersPageRedirect() {
  redirect("/settings/members")
}
