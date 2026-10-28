import { redirect } from "next/navigation";

// The admin/client interface is still the single-file prototype
// (public/admin.html) rather than real React pages — see the backend
// README's "How the admin prototype connects to this" section. Visiting
// the bare domain sends you straight there until that changes.
export default function Home() {
  redirect("/admin.html");
}
