import Link from "next/link";
import { notFound } from "next/navigation";
import { SCREENS } from "./screens";

export const metadata = { title: "Sign-in screens (development)" };

// Development only: an index of @tacit-ats/auth-ui's screens, each rendered with stand-in callbacks.
export default function AuthUiPreviewIndex() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="mx-auto w-full max-w-xl p-10">
      <h1 className="mb-1 text-xl font-semibold">@tacit-ats/auth-ui</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Development preview. Every call is a stand-in: sign-in fails with testbench&rsquo;s error after a moment, the other forms succeed.
      </p>
      <ul className="grid gap-2 text-sm">
        {Object.entries(SCREENS).map(([id, label]) => (
          <li key={id}><Link className="underline underline-offset-4" href={`/dev/auth-ui/${id}`}>{label}</Link></li>
        ))}
      </ul>
    </main>
  );
}
