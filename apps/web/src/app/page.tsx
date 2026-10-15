import { redirect } from "next/navigation";

// Everything lives under /client (lib/client/config.ts).
export default function Home() {
  redirect("/client");
}
