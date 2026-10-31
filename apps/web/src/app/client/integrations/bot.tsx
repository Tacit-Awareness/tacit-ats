"use client";

import { useActionState } from "react";
import { CopyButton } from "@/components/copy-button";
import { Notice, Pill, Row, Rows, Section } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  enableBotAction, removeBotAction, rotateBotSecretAction, setBotAction, verifyBotAction, type SecretResult,
} from "./bot-actions";
import { BOT_ERRORS } from "./messages";

const quietButton = buttonVariants({ variant: "ghost", size: "sm", className: "text-muted-foreground" });

export type CompanyBot = { url: string; enabled: boolean; verifiedAt: string | null };

// The company's Grok bot: one-time setup, for admins. Everyone else just
// sees it is connected. The secret appears here once, right after it is made.
export function BotSection({ bot, connected, callbackUrl }: { bot: CompanyBot | null; connected?: boolean; callbackUrl: string | null }) {
  const [setState, set] = useActionState<SecretResult, FormData>(setBotAction, {});
  const [rotateState, rotate] = useActionState<SecretResult>(rotateBotSecretAction, {});
  const fresh = rotateState.secret ?? setState.secret;
  const keptOwnKey = setState.saved && !rotateState.secret;
  const error = rotateState.error ?? setState.error;
  const live = bot ? bot.enabled && !!bot.verifiedAt : !!connected;

  return (
    <Section flush id="bot" title="Grok Bot">
      <div className="grid gap-3 px-3.5 py-3">
        <p className="m-0 text-[13px] text-muted-foreground">One-time setup for your team&apos;s bot.</p>
        {error ? <Notice tone="error">{BOT_ERRORS[error]}</Notice> : null}
        {fresh ? (
          <Notice>
            <span className="grid gap-1.5">
              <span>Your bot&apos;s secret. Put it in your bot now: Tacit will not show it again.</span>
              <span className="flex items-center gap-1">
                <code className="font-mono text-[12px] break-all">{fresh}</code>
                <CopyButton value={fresh} label="Copy the secret" />
              </span>
              <span>Then press Verify.</span>
            </span>
          </Notice>
        ) : null}
        {keptOwnKey ? <Notice>Saved with your bot&apos;s own key. Now press Verify.</Notice> : null}
      </div>
      {bot ? (
        <Rows ruled className="border-y border-[color:var(--line)]">
          <Row
            title={<span className="font-mono text-[12.5px] break-all">{bot.url}</span>}
            sub={!bot.enabled ? "Off: nothing is sent to it" : bot.verifiedAt ? "Getting your interviews" : "Waiting to be verified"}
            meta={
              <>
                <Pill tone={live ? "green" : "grey"}>
                  {!bot.enabled ? "Off" : bot.verifiedAt ? "Connected" : "Not verified"}
                </Pill>
                {!bot.verifiedAt ? (
                  <form action={verifyBotAction}>
                    <button type="submit" className={buttonVariants({ variant: "outline", size: "sm" })}>Verify</button>
                  </form>
                ) : null}
                <form action={enableBotAction}>
                  <input type="hidden" name="enabled" value={bot.enabled ? "false" : "true"} />
                  <button type="submit" className={quietButton}>{bot.enabled ? "Turn off" : "Turn on"}</button>
                </form>
                <form action={rotate}>
                  <button type="submit" className={quietButton}>New secret</button>
                </form>
                <form action={removeBotAction}>
                  <button type="submit" className={buttonVariants({ variant: "ghost", size: "sm", className: "text-muted-foreground hover:text-negative" })}>Remove</button>
                </form>
              </>
            }
          />
        </Rows>
      ) : connected !== undefined ? (
        <Rows ruled className="border-y border-[color:var(--line)]">
          <Row
            title="Your team's bot"
            sub={live ? "Getting your interviews" : "Not set up"}
            meta={<Pill tone={live ? "green" : "grey"}>{live ? "Connected" : "Not connected"}</Pill>}
          />
        </Rows>
      ) : null}

      {bot !== null || connected === undefined ? (
        <form action={set} className="grid gap-3 px-3.5 py-3.5">
          <div className="grid gap-1.5">
            <Label htmlFor="bot-url">Address:</Label>
            <Input id="bot-url" name="url" type="url" required maxLength={2000} placeholder="https://" autoComplete="off" className="max-w-[420px]" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="bot-key">Your bot&apos;s key:</Label>
            <Input id="bot-key" name="key" type="password" maxLength={512} autoComplete="off" className="max-w-[420px]" />
          </div>
          <SubmitButton pendingLabel="Saving…" className="justify-self-start">
            {bot ? "Change address" : "Enter"}
          </SubmitButton>
          {callbackUrl ? (
            <p className="m-0 max-w-[72ch] text-xs text-faint">
              Your bot tells Tacit which thread it opened at <code className="font-mono break-all">{callbackUrl}</code>, or in its answer.
            </p>
          ) : null}
        </form>
      ) : null}
    </Section>
  );
}
