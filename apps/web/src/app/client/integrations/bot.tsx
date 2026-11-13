"use client";

import { useActionState } from "react";
import { CopyButton } from "@/components/copy-button";
import { Notice, Pill, Section } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { ConnectedTag, SetRow } from "../settings/rows";
import {
  enableBotAction, removeBotAction, rotateBotSecretAction, setBotAction, verifyBotAction, type SecretResult,
} from "./bot-actions";
import { BOT_ERRORS } from "./messages";

const quiet = buttonVariants({ variant: "ghost", size: "sm" });
/** A note inside the card sits in a recessed well, not a card of its own (the ring replaces Notice's raised shadow). */
const well = "bg-[color:var(--soft)] shadow-[inset_0_0_0_1px_var(--line)]!";

export type CompanyBot = { url: string; enabled: boolean; verifiedAt: string | null };

/** What the section is for: on its title's hover, and read out after it. */
const SETUP = "One-time setup for your team's bot.";

// The company's Grok bot: one-time setup, for admins. Everyone else just
// sees it is connected. The secret appears here once, right after it is made.
// Drawn as Settings' other cards (settings/rows.tsx): the bot's row with its
// tag and controls, then the form under a hairline.
export function BotSection({ bot, connected, callbackUrl }: { bot: CompanyBot | null; connected?: boolean; callbackUrl: string | null }) {
  const [setState, set] = useActionState<SecretResult, FormData>(setBotAction, {});
  const [rotateState, rotate] = useActionState<SecretResult>(rotateBotSecretAction, {});
  const fresh = rotateState.secret ?? setState.secret;
  const keptOwnKey = setState.saved && !rotateState.secret;
  const error = rotateState.error ?? setState.error;
  const live = bot ? bot.enabled && !!bot.verifiedAt : !!connected;
  const showForm = bot !== null || connected === undefined;

  return (
    <Section
      flush
      id="bot"
      title={
        <span title={SETUP}>
          Grok bot<span className="sr-only">. {SETUP}</span>
        </span>
      }
    >
      {error || fresh || keptOwnKey ? (
        <div className="grid gap-2 border-b border-[color:var(--line)] px-5 py-4">
          {error ? <Notice tone="error">{BOT_ERRORS[error]}</Notice> : null}
          {fresh ? (
            <Notice className={cn(well, "text-foreground")}>
              <span className="grid gap-2">
                <span>Your bot&apos;s secret. Put it in your bot now: Tacit will not show it again.</span>
                <span className="flex items-center gap-1 rounded-[7px] bg-[color:var(--paper)] py-1 pr-1 pl-3 shadow-[inset_0_0_0_1px_var(--field)]">
                  <code className="min-w-0 flex-1 font-mono text-[12px] break-all">{fresh}</code>
                  <CopyButton value={fresh} label="Copy the secret" className="rounded-[7px] hover:bg-[color:var(--hover)]" />
                </span>
                <span>Then press Verify.</span>
              </span>
            </Notice>
          ) : null}
          {keptOwnKey ? <Notice className={well}>Saved with your bot&apos;s own key. Now press Verify.</Notice> : null}
        </div>
      ) : null}
      {bot ? (
        <SetRow
          name={<span className="font-mono text-[12.5px] font-normal [overflow-wrap:anywhere]">{bot.url}</span>}
          detail={!bot.enabled ? "Off: nothing is sent to it" : bot.verifiedAt ? "Getting your interviews" : "Waiting to be verified"}
          action={
            <>
              {live ? (
                <ConnectedTag />
              ) : (
                <Pill tone={bot.enabled ? "amber" : "grey"}>{!bot.enabled ? "Off" : "Not verified"}</Pill>
              )}
              {!bot.verifiedAt ? (
                <form action={verifyBotAction}>
                  <button type="submit" className={buttonVariants({ variant: "outline", size: "sm" })}>Verify</button>
                </form>
              ) : null}
              <form action={enableBotAction}>
                <input type="hidden" name="enabled" value={bot.enabled ? "false" : "true"} />
                <button type="submit" className={quiet}>{bot.enabled ? "Turn off" : "Turn on"}</button>
              </form>
              <form action={rotate}>
                <button type="submit" className={quiet}>New secret</button>
              </form>
              <form action={removeBotAction}>
                <button type="submit" className={buttonVariants({ variant: "ghost", size: "sm", className: "hover:text-negative" })}>Remove</button>
              </form>
            </>
          }
        />
      ) : connected !== undefined ? (
        <SetRow
          name="Your team's bot"
          detail={live ? "Getting your interviews" : "Not set up"}
          action={live ? <ConnectedTag /> : <Pill>Not connected</Pill>}
        />
      ) : null}

      {showForm ? (
        <form action={set} className={cn("grid gap-4 px-5 pt-4 pb-5", bot ? "border-t border-[color:var(--line)]" : null)}>
          <div className="grid gap-2">
            <Label htmlFor="bot-url">Address</Label>
            <Input id="bot-url" name="url" type="url" required maxLength={2000} placeholder="https://" autoComplete="off" className="max-w-[440px]" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="bot-key">Your bot&apos;s key</Label>
            <Input id="bot-key" name="key" type="password" maxLength={512} autoComplete="off" className="max-w-[440px]" />
          </div>
          <SubmitButton pendingLabel="Saving…" className="justify-self-start">
            {bot ? "Change address" : "Enter"}
          </SubmitButton>
          {callbackUrl ? (
            <p className="m-0 max-w-[72ch] text-[12px] leading-[18px] text-faint">
              Your bot tells Tacit which thread it opened at <code className="set-code">{callbackUrl}</code>, or in its answer.
            </p>
          ) : null}
        </form>
      ) : null}
    </Section>
  );
}
