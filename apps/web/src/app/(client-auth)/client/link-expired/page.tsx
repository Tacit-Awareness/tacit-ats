import type { Metadata } from "next";
import { LinkExpiredScreen } from "../screens";

export const metadata: Metadata = { title: "Link expired · tATS" };

export default function LinkExpiredPage() {
  return <LinkExpiredScreen />;
}
