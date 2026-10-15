# @tacit-ats/core

The client ATS's domain logic: first sign-in, a client admin's invitations, and every tool the client connector (apps/mcp `/api/client`) exposes. Moved from Tacit-Awareness's `packages/core` on 2026-10-14 with its history.

## What it builds on

It never reimplements what Tacit-Awareness owns. The pipeline (`addCandidateToRole`, `moveStage`, `setNextAction`, `logTouch`, `getRolePipeline`, the stage and source lists), the staff connector's email pieces (`connector.makeResendSender`, `connector.fromHeader`, `connector.isPlainEmail`), `renderTemplate`, and the org-onboarding types all come from `@tacit/core`, the vendored build in `vendor/` (root `CLAUDE.md`). `pipeline.ts` there is still the only writer of `applications` and `application_events`, for staff and clients alike. If a tool here needs something `@tacit/core` does not export, add the export there, merge it, and `pnpm sync:tacit`; do not copy the code here.

## The DI contract

Same as Tacit-Awareness's core: nothing here reads `process.env` or constructs a client at module load. Every function takes the database client (almost always the MEMBER'S OWN, a member token) and its other dependencies (WorkOS as `InviteDeps`, Storage as a `FileStore`, Resend as a `ClientMailer`) as parameters. Apps read env at their edge.

## Module map

```
src/
  client-auth/          client orgs' sign-in and onboarding (2026-10-13; ATS parity
                        spec, Phase 1). bind.ts -- bindClientActor(db, identity):
                        a first sign-in is matched to the actor an admin invited,
                        by verified email inside the token's WorkOS organization
                        (client orgs only); a returning one resolves by subject.
                        Never creates an actor; takes a SERVICE-ROLE client.
                        Staff onboarding (createClientOrg, inviteOrgMember,
                        listClientOrgs) stayed in Tacit-Awareness's
                        client-auth/orgs.ts, behind its /orgs page; the
                        IdentityProvider and AccessLevel types come from
                        there. invite.ts --
                        the client side (2026-10-14): inviteClientMember /
                        withdrawClientInvite / listPendingInvites run on a
                        client ADMIN'S OWN token, through the invite_org_member
                        / withdraw_org_invite / org_pending_invites definer
                        functions, so the org is the token's and never a
                        parameter. WorkOS sends after the row exists; a refused
                        first send withdraws it. ClientInviteError maps the
                        functions' SQLSTATEs (42501, 22023, 23505)
  client-tools/         the client connector's tools (apps/mcp /api/client,
                        2026-10-14); exported as the `clientTools` namespace.
                        Every function takes the MEMBER'S OWN client (a member
                        token) and a ClientToolCtx {actorId, orgId,
                        accessLevel, source}: the policies decide what each
                        read returns and whether each write lands, and nothing
                        here filters by org. What the code adds: asking the
                        policies' own helpers (can_on_role, can_add_people,
                        can_edit_application) before a write, so a refusal is
                        a sentence (ClientToolError: not_found / forbidden /
                        invalid / rate_limited) rather than a write that
                        silently changed nothing; and an interviewer's
                        narrower reads through my_interview_candidates (no
                        pipeline, a five-field card, their own notes).
                        reads.ts: listJobs, getJobPipeline (over
                        ../pipeline getRolePipeline), searchCandidates,
                        getCandidate, listTeam. writes.ts: addCandidate (over
                        ../pipeline/candidate addCandidateToRole), updateStage
                        (moveStage with the stage the member last saw),
                        setApplicationNextAction, addNote. audit.ts withAudit:
                        client_claim_write before the write (null = the
                        hourly limit), client_finish_write after, keeping the
                        row only when something changed (a ClientToolError
                        thrown inside the write gives the claim back too).
                        admin.ts: createJob / updateJob, getHiringTeam /
                        addToHiringTeam / removeFromHiringTeam,
                        setMemberAccess (set_org_member_access), inviteMember /
                        listInvites / withdrawInvite (over client-auth's
                        invite.ts, WorkOS injected as InviteDeps). New rows
                        (a job, its company) get their id in code and are
                        never read back: the roles read policy's helpers
                        cannot see a row inserted by the same statement
                        interviews.ts: listMyInterviews (my_interviews()),
                        scheduleInterview / updateInterview (Tacit's record
                        only, no calendar; times need an offset),
                        submitFeedback (the caller's own, once started, notes
                        kept out of the audit row) and getFeedback (what the
                        org's feedback_visibility lets the caller read).
                        offers.ts (2026-10-14): listRejectionReasons,
                        getOffers / createOffer / updateOffer (whoever can
                        manage the job; a new offer gets its id in code;
                        updates are conditional on the status read; notes
                        stay out of the audit row; the database's 22023 /
                        23505 refusals come back as sentences). updateStage
                        to rejected or withdrawn REQUIRES a reason of the
                        matching kind (reasonForStage) and takes a note;
                        the same call on an application already there
                        replaces the reason. pipeline.ts moveStage takes an
                        optional closeReason for this, written with the
                        move and named in the event's detail.
                        plans.ts (2026-10-15): a job's interview plan IS
                        roles.interview_steps, the jsonb list of step names
                        connector/roles.ts and scheduling.ts already read,
                        so staff and client write one plan; no new table
                        and no per-step fields. getInterviewPlan (the steps;
                        with an application, each step's interviews and
                        state, each interviewer's feedback filed / not_filed
                        / hidden -- who filed, never what, with the policy's
                        own can_see_feedback telling absent from hidden --
                        plus off-plan interviews and the next step; an
                        interviewer, who cannot read the application, sees
                        only their own interviews, found through
                        application_role) and setInterviewPlan (whoever can
                        manage the job; the whole list replaced, at most 15
                        distinct one-line names of 120 characters; audited
                        as role.interview_plan). Interviews name their step
                        as text, so a removed step stays on them, off-plan,
                        and the result counts them. scheduleInterview checks
                        `step` against the plan when there is one and writes
                        the plan's spelling (planStep, the client twin of
                        scheduling.ts's canonicalStep); a second scheduled
                        interview on one step is a sentence, not a 23505.
                        files.ts (2026-10-15): listFiles, getFileLink,
                        addFile over person_files; getCandidate carries the
                        files too (filesFor). Storage is a FileStore {put,
                        signedUrl} passed in, never a client: called only
                        after the member's own client has read the row (a
                        link, signed for FILE_LINK_SECONDS = 300 on the
                        row's own <org_id>/<person_id>/<id> path, refused if
                        the row names another) or inserted it (an upload).
                        addFile checks everything before a query: kind,
                        content type (FILE_TYPES: pdf, doc, docx, txt, png,
                        jpeg), filename characters and extension, strict
                        base64 sized before decoding (FILE_MAX_BYTES = 3 MB,
                        under Vercel's 4.5 MB request body), and that the
                        bytes start like their type. Then can_edit_person,
                        the claim, the row (id made in code, no read-back),
                        the bytes; a failed upload deletes the row on the
                        member's token and gives the claim back. Null store
                        = a sentence. The filename stays out of the audit
                        row.
                        scorecards.ts (2026-10-15): getScorecard (anyone
                        who can see the job) and setScorecard (whoever can
                        manage it): the list given becomes the job's live
                        scorecard in order, matched to existing attributes
                        by name (any case, archived ones too, which brings
                        them back) or renamed by attributeId; anything
                        left out is archived, never deleted; the same list
                        twice claims nothing. New attributes get their id
                        in code; descriptions stay out of the audit row.
                        submitFeedback takes optional ratings
                        ({attributeId, rating 1-4, note}), checked against
                        the job's live scorecard first (application_role,
                        since an interviewer cannot read the application),
                        inserted under ids made in code after the feedback
                        upsert; filing again deletes and replaces them.
                        Rating notes, like feedback notes, stay out of the
                        audit row. getFeedback returns each feedback's
                        ratings with the attribute's name, in the
                        scorecard's order.
                        tags.ts (2026-10-15): listTags (with how many
                        candidates the member can see carry each),
                        createTag (anyone who can_add_people; a name
                        already there ignoring case is answered with, an
                        archived one restored by an admin), archiveTag
                        (admins), tagCandidate / untagCandidate (whoever
                        can_edit_person). A tag is named by id or by name
                        ignoring case, matched in code over the org's tags
                        (findTag). Interviewers get no tags. New rows get
                        their id in code; a 23505 race is the same outcome
                        as already there, its claim given back.
                        searchCandidates takes a `tag`, getCandidate
                        carries the tags and each job's source and
                        source_detail, addCandidate takes `source` (one
                        of pipeline.ts's CANDIDATE_SOURCES) and
                        `sourceDetail` (kept out of the audit row).
                        activity.ts getActivity: one candidate's
                        application_events, notes, interviews (scheduled,
                        then done / cancelled at updated_at), offers
                        (drafted, extended, closed; status only, never the
                        terms) and tags, newest first, cut to the limit
                        after merging, each named through org_members.
                        Every read is the member's own, so what they
                        cannot read is absent. An interviewer is answered
                        with their own notes and their interviews of that
                        candidate through my_interviews(), not refused:
                        it is what get_candidate and list_my_interviews
                        already give them, in order.
                        email.ts (2026-10-16): candidate email, always
                        two steps. Templates (email_templates):
                        listEmailTemplates (above interviewer),
                        createEmailTemplate / updateEmailTemplate
                        (admins; renamed, rewritten, archived or restored,
                        never deleted; found by id or name ignoring case;
                        a placeholder outside EMAIL_PLACEHOLDERS --
                        candidate_first_name, candidate_name, job_title,
                        company_name, sender_name, sender_first_name -- is
                        refused). draftEmail (whoever can_edit_person,
                        never an interviewer): from a template or a
                        subject and body (which override the template's),
                        optionally tied to one of the candidate's
                        applications (fills job_title, and the send logs
                        a touch on it); placeholders filled, any left
                        unfilled refuses the draft; the recipient is an
                        address on file (people.email + email
                        person_identifiers), to_email picking another;
                        stored in candidate_emails under an id made in
                        code. sendEmail: the author only, the recipient
                        re-checked, the audit claim, then draft ->
                        sending as a conditional update (the database
                        holds a member to CLIENT_SENDS_PER_HOUR = 30,
                        54000 -> rate_limited), then the injected
                        ClientMailer's `send` (connector/email.ts's
                        makeResendSender, built in apps/mcp) keyed by
                        the draft id, From `fromHeader("<member> at
                        <org>", mailer.fromAddress)` with Reply-To the
                        member's own address; sent, or failed with the
                        error (the claim kept either way). A null mailer
                        = email turned off; a null `send` = drafts only.
                        Subjects and bodies stay out of every audit row.
                        listEmails / emailsFor: what the member reads
                        (sent ones, and their own drafts). getCandidate
                        carries `emails` (no bodies); getActivity has an
                        `email` entry per sent email (the subject as
                        text)
  test-helpers/         fake Supabase client for unit tests (excluded from the
                        build; a copy of Tacit-Awareness's)
```

## Tests

- Unit tests are colocated (`*.test.ts`), run by `pnpm test` from the root, with `FakeSupabase` -- no network, no Docker.
- `client-auth/onboarding.integration.test.ts` runs Tacit-Awareness's staff onboarding into this package's first sign-in against the local stack (`pnpm test:integration`, root `CLAUDE.md`).
