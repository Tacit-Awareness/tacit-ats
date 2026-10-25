# @tacit-ats/core

The client ATS's domain logic: first sign-in, a client admin's invitations, and every tool the client connector (apps/mcp `/api/client`) exposes. Moved from tacit-internal's `packages/core` on 2026-10-16 with its history.

## What it builds on

It never reimplements what tacit-internal owns. The pipeline (`addCandidateToRole`, `moveStage`, `setNextAction`, `logTouch`, `getRolePipeline`, the stage and source lists), the staff connector's email pieces (`connector.makeResendSender`, `connector.fromHeader`, `connector.isPlainEmail`), `renderTemplate`, and the org-onboarding types all come from `@tacit/core`, the vendored build in `vendor/` (root `CLAUDE.md`). `pipeline.ts` there is still the only writer of `applications` and `application_events`, for staff and clients alike. If a tool here needs something `@tacit/core` does not export, add the export there, merge it, and `pnpm sync:tacit`; do not copy the code here.

## The DI contract

Same as tacit-internal's core: nothing here reads `process.env` or constructs a client at module load. Every function takes the database client (almost always the MEMBER'S OWN, a member token) and its other dependencies (WorkOS as `InviteDeps`, Storage as a `FileStore`, Resend as a `ClientMailer`, Google Calendar as a `ClientCalendar`, Granola as a `ClientGranola`) as parameters. Apps read env at their edge.

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
                        listClientOrgs) stayed in tacit-internal's
                        client-auth/orgs.ts, behind its /admin/orgs page; the
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
                        scheduleInterview / updateInterview (times need an
                        offset; with a ClientCalendar, booked on the member's
                        Google Calendar: see calendar.ts),
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
                        approvals.ts (2026-10-15, 20261016110000): approval
                        chains per job, kind `offer` (gates draft ->
                        extended) or `job_open` (gates moving the job to
                        open). The gates are database triggers, so
                        updateOffer / updateJob need nothing new beyond
                        turning the 22023 into a sentence that names
                        request_approval. getApprovalFlow (managers and the
                        flow's approvers; job_open also returns the latest
                        request), setApprovalFlow (whoever manages the job;
                        steps = string[][], any one approver per step, at
                        most 10 x 10, nobody twice, every id an active
                        member, checked in code first; [] clears; the same
                        flow claims nothing), requestApproval (offerId XOR
                        jobId; a draft offer, a job not open, a flow that
                        exists; already_pending / already_approved give the
                        claim back), listMyApprovals (my_approvals(): what
                        waits on the caller's step, with the candidate and
                        the terms for an offer), decideApproval (approve or
                        reject with a required reason; a request no longer
                        pending is answered `not_pending` without a claim;
                        someone not at the waiting step is told which step
                        it waits on). Every write is a definer function
                        (set_approval_flow / request_approval /
                        decide_approval), audited as approval_flow.set,
                        approval.request, approval.approve / .reject; the
                        reason stays out of the audit row. getOffers carries
                        each offer's `approval` (null with no flow and no
                        request) from offerApprovals; getActivity adds
                        approval.requested / .approved / .rejected / .reset
                        / .cancelled for the candidate's offers
                        custom-fields.ts (2026-10-16): per-org custom
                        fields on a candidate, job or offer
                        (CUSTOM_FIELD_OBJECTS; CUSTOM_FIELD_TYPES:
                        short_text, long_text, number, date, yes_no,
                        single_select, multi_select, url).
                        listCustomFields (above interviewer),
                        createCustomField and updateCustomField (admins:
                        rename, private on/off, archive / restore, and a
                        select field's options as a list that becomes
                        the live set in order -- renamed by optionId,
                        matched by name, added, the rest archived, never
                        deleted), setCustomField (value null clears; the
                        object checked first with the same helpers the
                        policies use: can_edit_person for a candidate,
                        plus can_manage_job on one of their jobs for a
                        private field unless admin; can_manage_job for a
                        job; an offer must be a draft). A field is named
                        by id or by name ignoring case within its object,
                        matched in code over the org's fields. Values are
                        checked against the type here and again by the
                        database's trigger; select values are stored as
                        option ids and shown as names, and an archived
                        option stays on whoever had it but is chosen by
                        no one new. A long_text value stays out of the
                        audit row. customFieldValuesFor(db, object, ids)
                        is the read the others use: getCandidate,
                        listJobs, getJobPipeline and getOffers carry
                        `customFields` (live fields only, in the fields'
                        order; empty for an interviewer). New rows get
                        their id in code, never read back
                        structure.ts (2026-10-16): listDepartments (each
                        with its path, "Engineering > Platform", and the
                        jobs the member can see in it), createDepartment
                        (optionally inside a parent) / updateDepartment
                        (rename, move, archive or bring back; a move that
                        would put one inside itself is refused before the
                        claim, and the database refuses it too),
                        listOffices / createOffice / updateOffice (name,
                        location, archive). Admins write, interviewers
                        read none; named by id or name ignoring case,
                        matched in code over the org's rows (pickByRef);
                        an existing name is answered with, an archived
                        one restored. Nothing deletes either.
                        createJob takes `department`, `offices` and
                        `openings` (1 unless said, 0 for a job made filled
                        or closed), all in the one role.create write;
                        updateJob takes `department` (null clears) and
                        `offices` (the whole set; only the difference is
                        written), refusing an archived one unless the job
                        already has it. listJobs carries each job's
                        department, offices and opening counts and takes
                        `department` (with the ones inside it) and
                        `office` filters.
                        openings.ts (2026-10-16): listOpenings (counts and
                        rows, who filled each), addOpenings (ids made in
                        code, one insert, numbers read afterwards: the
                        database numbers them; codes unique in the org),
                        closeOpening (an open one, with a reason kept out
                        of the audit row; a filled one is refused). The
                        filling is the database's (fill_opening_on_hire):
                        updateStage to hired reads back the opening it
                        filled (openingFilledBy), how many are left open
                        and the job's status, best-effort after the move
                        has committed
                        pools.ts (2026-10-16): prospects and talent pools.
                        A prospect is a person in the org with no
                        application. addProspect (anyone who
                        can_add_people; name / email / LinkedIn through
                        pipeline/candidate.ts parseCandidateIdentity, the
                        same parse add_candidate uses; an email already on
                        file that the member can see is reused and not
                        changed; people.added_by_actor_id = the member,
                        prospect_source / prospect_source_detail; optional
                        pool), convertProspect (into a job over ../pipeline
                        addToPipeline, for whoever has can_edit_pipeline on
                        it; the application takes the source given, else
                        the prospect's, else sourced; pools untouched;
                        audited as prospect.convert). Pools: listPools,
                        createPool (can_add_people; an existing name is
                        answered with, an archived one restored by an
                        admin), archivePool (admins), addToPool (new
                        member at a stage, or with `stage` a move
                        conditional on the stage read), removeFromPool,
                        listPool. POOL_STAGES: new, contacted, engaged,
                        not_interested. A pool is named by id or by name
                        ignoring case (findPool, as findTag). Interviewers
                        are refused every one of them before a query.
                        searchCandidates takes `pool` and `prospectsOnly`
                        (reads up to 200 rows, keeps those in no job the
                        member can see, then asks person_in_no_pipeline,
                        since an admin does not see a confidential job's
                        applications); getCandidate carries `prospect`,
                        the prospect source and `pools` (poolsFor). New
                        rows get their id in code; source details stay out
                        of the audit row
                        posts.ts (2026-10-16): job posts and the
                        applications they bring in. createJobPost (a
                        draft; id and slug made in code, never read back;
                        title defaults to the job's), updateJobPost (text
                        and questions, any status, conditional on the
                        updated_at read; a custom question passed again
                        under its label keeps its id), setJobPostStatus
                        (live | closed, conditional on the status read;
                        live needs the job open), listJobPosts (questions,
                        whether it is accepting, applications counted under
                        the answers policy) -- whoever can manage the job,
                        never an interviewer. buildQuestions shapes and
                        checks the form before any query (name and email
                        always first and required; built-ins phone,
                        linkedin, resume; custom short_text, long_text,
                        yes_no, select) and jobPostUrl builds the public
                        link from an origin the caller passes.
                        listApplicationsInbox: applications with source
                        job_board at INBOX_STAGES ("applied" for a pipeline
                        that grows one, then "sourced"), newest first, with
                        their answers. answersFor reads application_answers
                        as the member; getCandidate and getJobPipeline
                        attach them to job_board applications only (so no
                        extra query otherwise). Descriptions stay out of
                        the audit row. The public half (job_post_public,
                        submit_job_application on the publishable key) is
                        apps/web's /jobs/[slug], not here.
                        merge.ts (2026-10-16): findDuplicates,
                        mergeCandidates, anonymizeCandidate, admins only,
                        refused before any query for anyone else.
                        findDuplicates reads up to 5,000 of the org's
                        candidates (anonymized ones filtered, merged ones
                        hidden by the policy) plus their email identifiers
                        on the member's token and groups them in code
                        (union-find) by email ignoring case, LinkedIn
                        profile (linkedinKey: linkedin.com/in/<slug>) or
                        exact name. The two writes are the definer functions
                        client_merge_candidates / client_anonymize_candidate
                        (20261016160000) inside withAudit (person.merge /
                        person.anonymize; ids, counts and column names only,
                        never a name). A merge is soft: the duplicate stays,
                        merged_into the record kept. anonymizeCandidate
                        checks confirm == "ANONYMIZE <name on file>"
                        (confirmationFor; the id when there is no name, and
                        the database checks it again), refuses a candidate
                        with files when the FileStore has no remove(), and
                        removes the returned storage paths only after the
                        database committed: a Storage failure then is
                        reported (storage: "failed", paths logged), not
                        thrown. FileStore gained the optional remove();
                        getFileLink accepts <org>/<any person uuid>/<id>,
                        since a merged file keeps the path it was uploaded at
                        reports.ts (2026-10-16): pipelineReport (per
                        stage: now, reached (a skipped stage counts as
                        passed), conversion to the next forward stage,
                        average days per ended stay from application_events),
                        sourceReport, timeToHire (a hire = stage hired now,
                        dated by its last move to hired; a job opens at
                        roles.created_at, there is no opened date),
                        rejectionReport (closed now, by the last move to
                        that stage, per reason), interviewerActivity
                        (admins, or whoever can_manage_job on some job,
                        over the jobs they manage; on time = within
                        FEEDBACK_ON_TIME_HOURS = 24 of the end; a filing
                        the caller's token cannot see is not_visible,
                        told apart from not filed by can_see_feedback) and
                        offerReport. Plain reads on the member's token, no
                        SQL function, so each counts only what the member
                        reads; scan() pages 1,000 rows (the API's max) up
                        to REPORT_SCAN_MAX = 5000 (events 10,000) and the
                        report says truncated. Interviewers are refused
                        before any query. `since` is a YYYY-MM-DD day.
                        eeoc.ts (2026-10-16): recordEeoc (a manager on the
                        job types in a paper EEO form through the
                        record_eeoc definer function; audited as
                        eeoc.record with NO answer in the row or the call
                        log) and eeocReport (admins only: per answer,
                        applicants and hires, every cell under
                        EEOC_MIN_CELL = 5 "<5", a lone small cell's
                        smallest neighbour "hidden" so it cannot be
                        subtracted out, no breakdown at all under five
                        responses). It never returns a row, even to an
                        admin, and eeoc.test.ts fails if any other file
                        here names eeoc_responses, so get_candidate and
                        get_activity cannot start showing EEO answers
                        connector.ts (2026-10-15, 20261017110000): the
                        connector's own read-only switch, org-wide.
                        getConnectorSettings (any member: orgs.
                        connector_access, who set it, when) and
                        setConnectorAccess (admins; set_connector_access,
                        claimed as CONNECTOR_ACCESS_ACTION =
                        org.connector_access, the one claim the database
                        still takes in a read-only org, from an admin). In
                        a read-only org every other claim raises 42501 and
                        withAudit throws ClientToolError(forbidden,
                        READ_ONLY_REFUSAL), so every write here is refused
                        before it starts; a new write must go through
                        withAudit or it escapes the switch
                        calendar.ts (2026-10-17, 20261017120000): calendar
                        scheduling. ClientCalendar {google: the OAuth client,
                        connections(orgId, actorIds): the members' grants,
                        read by apps/mcp with the service role, connectUrl}.
                        availability(): each interviewer's busy intervals
                        through their own grant, else the caller's (or the
                        event holder's) asking for their address, else
                        unknown with a reason; one freeBusy per access
                        token, over @tacit/core's connector.freeBusy.
                        findInterviewTimes (not interviewers; window <= 14
                        days, working hours in an IANA zone, half-hour
                        starts, round-robin across days; zonedInstant /
                        wallClock do the zone math with Intl only).
                        interviews.ts books with it: scheduleInterview
                        checks conflicts before any write, picks the holder
                        (an interviewer, so they organize the event: the
                        caller if interviewing and connected, else the first
                        connected interviewer, else the caller; 2026-10-25,
                        tacit-internal 20261025120000), inserts the row with
                        calendar_actor_id = the holder, creates the event
                        with the holder's grant under the row's id without
                        dashes (connector.createInterviewEvent, Meet unless
                        a location), deletes the row if Google refuses; updateInterview moves / re-invites /
                        cancels the event with the HOLDER's grant after the
                        row's conditional update, putting the row back if
                        Google refuses; update_calendar false = record only.
                        The event's guests are the holder (so Google shows
                        an organizer), the other interviewers and, since
                        2026-10-25, the candidate at people.email (not
                        invited without one: candidateInvited); new
                        interviewers keep both on. The candidate also gets a
                        draftEmail draft for a booking, a move or a
                        cancellation; a draft
                        that cannot be written is reported, not thrown.
                        Without a ClientCalendar both behave as before
                        granola.ts (2026-10-19, 20261019200000):
                        getInterviewNotes, the caller's own Granola notes
                        from an interview they were an interviewer on.
                        ClientGranola {accessToken(orgId, actorId): the
                        caller's token, read and refreshed by apps/mcp with
                        the service role (null = not connected, reconnect =
                        Granola dropped the grant), connectUrl, fetch?}.
                        The interview is read on the member's token (RLS
                        first), then Granola's MCP server is asked
                        (granolaMcp: initialize, tools/call, JSON or event
                        stream): list_meetings within 3 h of it, matched in
                        Granola's text by the booked event id, the
                        candidate's email (when readable), or being the one
                        meeting during the interview; or a note_id given.
                        Returns get_meetings' text and, asked for,
                        get_meeting_transcript's, clipped; the server
                        fences them. The tools answer text, not a schema,
                        so meetingsIn splits a list by meeting id (uuids)
  test-helpers/         fake Supabase client for unit tests (excluded from the
                        build; a copy of tacit-internal's) and fake-google.ts
                        (Google's token endpoint and Calendar API as fetch)
```

## Tests

- Unit tests are colocated (`*.test.ts`), run by `pnpm test` from the root, with `FakeSupabase` -- no network, no Docker.
- `client-auth/onboarding.integration.test.ts` runs tacit-internal's staff onboarding into this package's first sign-in against the local stack (`pnpm test:integration`, root `CLAUDE.md`).
