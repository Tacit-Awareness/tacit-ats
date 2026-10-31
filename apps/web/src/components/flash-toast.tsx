import { Flash } from "@/components/toasts";

/**
 * A server page's way to say what `?notice=` meant, where its `Notice` was. A
 * server component on purpose, and never imported from a `"use client"` file:
 * the stamp has to be this render's on the server, or every render in the
 * browser would be a new message.
 */
export function FlashToast(props: { text: string; action?: React.ReactNode }) {
  return <Flash {...props} stamp={Date.now()} />;
}
