"use client";

import { useActionState } from "react";
import { CopyButton } from "@/components/copy-button";
import { Notice, Pill, Row, Rows, Section, textLink } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  enableBotAction, removeBotAction, rotateBotSecretAction, setBotAction, verifyBotAction, type SecretResult,
} from "./bot-actions";
import { BOT_ERRORS } from "./messages";

export type CompanyBot = { url: string; enabled: boolean; verifiedAt: string | null };

// The company's own bot, for admins only (page.tsx reads the row, which only
// an admin's token can). Tacit sends it each interview's moments: a hello
// five minutes before, a check-in after, and a note when one is cancelled.
// The secret appears here once, right after it is made.
export function BotSection({ bot, orgName, callbackUrl }: { bot: CompanyBot | null; orgName: string; callbackUrl: string | null }) {
  const [setState, set] = useActionState<SecretResult, FormData>(setBotAction, {});
  const [rotateState, rotate] = useActionState<SecretResult>(rotateBotSecretAction, {});
  const fresh = rotateState.secret ?? setState.secret;
  const error = rotateState.error ?? setState.error;

  return (
    <div id="bot" className="grid">
      <Section title="Your team's bot">
        <div className="grid gap-3">
          <p className="m-0 text-[13px] text-muted-foreground">
            Tacit tells your Slack bot about every interview at {orgName}: a hello five minutes before it starts, a check-in
            once it ends, and a note if it is cancelled. Your bot writes to the interviewer; Tacit never posts in your Slack
            itself.
          </p>
          {error ? <Notice tone="error">{BOT_ERRORS[error]}</Notice> : null}
          {fresh ? (
            <Notice>
              <span className="grid gap-1.5">
                <span>Your bot&apos;s secret. Put it in your bot now: Tacit will not show it again.</span>
                <span className="flex items-center gap-1">
                  <code className="font-mono text-[12px] break-all">{fresh}</code>
                  <CopyButton value={fresh} label="Copy the secret" />
                </span>
                <span>Every request carries it as a Bearer token and signs with it (X-Tacit-Signature). Then press Verify.</span>
              </span>
            </Notice>
          ) : null}

          {bot ? (
            <Rows>
              <Row
                title={<span className="font-mono text-[12.5px] break-all">{bot.url}</span>}
                sub={
                  !bot.enabled
                    ? "Off: nothing is sent to it"
                    : bot.verifiedAt
                      ? "Getting your interviews"
                      : "Waiting to be verified: nothing is sent until it answers Tacit's challenge"
                }
                meta={
                  <>
                    <Pill tone={bot.enabled && bot.verifiedAt ? "green" : "grey"}>
                      {!bot.enabled ? "Off" : bot.verifiedAt ? "Verified" : "Not verified"}
                    </Pill>
                    <form action={verifyBotAction}>
                      <button type="submit" className={`${textLink} cursor-pointer`}>Verify</button>
                    </form>
                    <form action={enableBotAction}>
                      <input type="hidden" name="enabled" value={bot.enabled ? "false" : "true"} />
                      <button type="submit" className={`${textLink} cursor-pointer`}>{bot.enabled ? "Turn off" : "Turn on"}</button>
                    </form>
                    <form action={rotate}>
                      <button type="submit" className={`${textLink} cursor-pointer`}>New secret</button>
                    </form>
                    <form action={removeBotAction}>
                      <button type="submit" className={`${textLink} cursor-pointer hover:text-negative`}>Remove</button>
                    </form>
                  </>
                }
                className="py-2.5"
              />
            </Rows>
          ) : null}

          <form action={set} className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="bot-url">{bot ? "Change its address" : "Your bot's address"}</Label>
              <Input id="bot-url" name="url" type="url" required maxLength={2000} placeholder="https://" autoComplete="off" />
            </div>
            <SubmitButton pendingLabel="Saving…" className="justify-self-start">
              {bot ? "Change address" : "Save"}
            </SubmitButton>
            <p className="m-0 text-xs text-faint">
              A new address gets a new secret, and needs verifying again.
              {callbackUrl ? <> Your bot tells Tacit which Slack thread it opened at <code className="font-mono">{callbackUrl}</code>, or in its answer.</> : null}
            </p>
          </form>
        </div>
      </Section>
    </div>
  );
}
