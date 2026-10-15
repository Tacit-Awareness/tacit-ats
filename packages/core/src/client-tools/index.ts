export { ClientToolError, LIST_MAX, NOTE_MAX } from "./context.js";
export type { AccessLevel, ClientToolCtx, ClientToolErrorCode } from "./context.js";
export { getCandidate, getJobPipeline, listJobs, listTeam, searchCandidates } from "./reads.js";
export type { CandidateDetail, CandidateHit, CandidateNote, JobPipeline, JobView, TeamMember } from "./reads.js";
export { addCandidate, addNote, setApplicationNextAction, updateStage } from "./writes.js";
export type { AddCandidateResult, NextActionResult, StageResult } from "./writes.js";
export {
  JOB_STATUSES, TEAM_ROLES,
  addToHiringTeam, createJob, getHiringTeam, inviteMember, listInvites, removeFromHiringTeam, setMemberAccess,
  updateJob, withdrawInvite,
} from "./admin.js";
export type { CreatedJob, HiringTeamMember, InviteDeps, JobChange, JobInput, JobStatus, TeamRole } from "./admin.js";
export {
  INTERVIEW_STATUSES, RECOMMENDATIONS,
  getFeedback, listMyInterviews, scheduleInterview, submitFeedback, updateInterview,
} from "./interviews.js";
export type {
  FeedbackEntry, FeedbackRating, FeedbackSummary, InterviewStatus, MyInterview, RatingInput, Recommendation,
} from "./interviews.js";
export {
  OFFER_STATUSES, REJECTION_KINDS,
  createOffer, getOffers, listRejectionReasons, updateOffer,
} from "./offers.js";
export type { Offer, OfferStatus, OfferTerms, RejectionKind, RejectionReason } from "./offers.js";
export { getScorecard, setScorecard } from "./scorecards.js";
export type { Scorecard, ScorecardAttribute, ScorecardChange, ScorecardEntry } from "./scorecards.js";
export { PLAN_STEPS_MAX, STEP_NAME_MAX, getInterviewPlan, setInterviewPlan } from "./plans.js";
export type { FeedbackState, InterviewPlan, PlanChange, PlanInterview, PlanProgress, StepState } from "./plans.js";
export {
  FILE_BASE64_MAX, FILE_KINDS, FILE_LINK_SECONDS, FILE_MAX_BYTES, FILE_TYPES,
  addFile, getFileLink, listFiles,
} from "./files.js";
export type { CandidateFile, FileKind, FileLink, FileStore } from "./files.js";
export { ACTIVITY_DEFAULT, getActivity } from "./activity.js";
export type { Activity, ActivityEntry, ActivityKind } from "./activity.js";
export { TAG_NAME_MAX, archiveTag, createTag, listTags, tagCandidate, untagCandidate } from "./tags.js";
export type { CreateTagResult, Tag, TagResult } from "./tags.js";
export {
  CLIENT_SENDS_PER_HOUR, EMAIL_BODY_MAX, EMAIL_PLACEHOLDERS, EMAIL_SUBJECT_MAX, TEMPLATE_NAME_MAX,
  createEmailTemplate, draftEmail, listEmailTemplates, listEmails, sendEmail, updateEmailTemplate,
} from "./email.js";
export type {
  CandidateEmail, CandidateEmailWithBody, ClientMailer, DraftEmailResult, EmailPlaceholder, EmailTemplate, SendEmailResult,
  TemplateChange,
} from "./email.js";
export {
  APPROVAL_KINDS, APPROVAL_REASON_MAX, APPROVAL_STEPS_MAX, APPROVERS_PER_STEP_MAX,
  decideApproval, getApprovalFlow, listMyApprovals, requestApproval, setApprovalFlow,
} from "./approvals.js";
export type {
  ApprovalApprover, ApprovalDecision, ApprovalFlow, ApprovalKind, ApprovalStatus, ApprovalStep, DecisionResult,
  JobApproval, MyApproval, OfferApproval, RequestApprovalResult,
} from "./approvals.js";
export {
  CUSTOM_FIELD_NAME_MAX, CUSTOM_FIELD_OBJECTS, CUSTOM_FIELD_OPTIONS_MAX, CUSTOM_FIELD_OPTION_MAX, CUSTOM_FIELD_TYPES,
  LONG_TEXT_MAX, SHORT_TEXT_MAX,
  createCustomField, listCustomFields, setCustomField, updateCustomField,
} from "./custom-fields.js";
export type {
  CreateCustomFieldResult, CustomField, CustomFieldChange, CustomFieldInput, CustomFieldObject, CustomFieldOption,
  CustomFieldType, CustomFieldValue, SetCustomFieldResult,
} from "./custom-fields.js";
export {
  DEPARTMENT_NAME_MAX, OFFICE_LOCATION_MAX, OFFICE_NAME_MAX,
  createDepartment, createOffice, listDepartments, listOffices, updateDepartment, updateOffice,
} from "./structure.js";
export type { Department, Office, StructureResult } from "./structure.js";
export {
  CLOSE_REASON_MAX, OPENINGS_ADD_MAX, OPENING_CODE_MAX, OPENING_STATUSES,
  addOpenings, closeOpening, listOpenings,
} from "./openings.js";
export type { HireOpening, JobOpenings, Opening, OpeningCounts, OpeningStatus } from "./openings.js";
export {
  POOL_NAME_MAX, POOL_STAGES,
  addProspect, addToPool, archivePool, convertProspect, createPool, listPool, listPools, removeFromPool,
} from "./pools.js";
export type {
  AddProspectResult, CandidatePool, ConvertResult, CreatePoolResult, Pool, PoolMember, PoolResult, PoolStage, PoolView,
} from "./pools.js";
export {
  INBOX_STAGES, JOB_POST_STATUSES, QUESTIONS_MAX, QUESTION_LABEL_MAX, QUESTION_TYPES,
  buildQuestions, createJobPost, jobPostUrl, listApplicationsInbox, listJobPosts, setJobPostStatus, updateJobPost,
} from "./posts.js";
export type {
  ApplicationAnswer, ApplicationAnswers, InboxEntry, JobPost, JobPostInput, JobPostStatus, Question, QuestionInput, QuestionType,
} from "./posts.js";
export { anonymizeCandidate, confirmationFor, findDuplicates, linkedinKey, mergeCandidates } from "./merge.js";
export type {
  AnonymizeResult, DuplicateCandidate, DuplicateGroup, DuplicateReason, Duplicates, MergeResult,
} from "./merge.js";
