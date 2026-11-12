import type { Metadata } from "next";
import { ForgotPasswordScreen } from "../screens";

export const metadata: Metadata = { title: "Reset your password · tATS" };

export default function ForgotPasswordPage() {
  return <ForgotPasswordScreen />;
}
