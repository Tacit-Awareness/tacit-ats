import { notFound } from "next/navigation";
import { authThemeScript } from "@tacit-ats/auth-ui";
import { SCREENS, isScreen } from "../screens";
import { Preview } from "./preview";

export const metadata = { title: "Sign-in screen (development)" };

// Development only: one @tacit-ats/auth-ui screen, full page, with stand-in callbacks (preview.tsx).
export default async function AuthUiPreviewScreen({ params }: { params: Promise<{ screen: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { screen } = await params;
  if (!isScreen(screen)) notFound();
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: authThemeScript() }} />
      <Preview screen={screen} label={SCREENS[screen]} />
    </>
  );
}
