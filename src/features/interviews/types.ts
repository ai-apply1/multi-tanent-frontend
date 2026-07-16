export type InterviewStatus = "in_progress" | "submitted" | "analyzed"

/**
 * Background AI-scoring lifecycle for a submitted interview attempt. Mirrors
 * the backend `ScoringStatus` enum, and is INDEPENDENT of `InterviewStatus`
 * (which tracks the candidate-facing submitted/abandoned state):
 *   idle          — no scoring run has been queued for this attempt
 *   queued        — a (re)scoring job is enqueued, worker hasn't picked it up
 *   processing    — the scoring pipeline is running
 *   done          — scoring completed; `scores` is populated
 *   failed        — the run errored (`scoringError` set; retryable via rescore)
 *   needs_review  — parked for manual review (`scoringError` explains why)
 * `queued` / `processing` mean "a run is in flight" — the drawer disables the
 * Rescore button and polls until it settles.
 */
export type ScoringStatus =
  | "idle"
  | "queued"
  | "processing"
  | "done"
  | "failed"
  | "needs_review"

/**
 * Lifecycle of the background webcam → HLS transcode that makes the
 * recording streamable in the drawer:
 *   pending     — recording present, transcode queued
 *   processing  — transcode in flight
 *   ready       — HLS bundle available (`webcamHlsUrl` populated)
 *   failed      — transcode failed (`webcamHlsError` set; retryable)
 * `null` when the session produced no recording.
 */
export type WebcamHlsStatus = "pending" | "processing" | "ready" | "failed"

/**
 * Tech the candidate listed on their CV. Backend sends only the name —
 * other internal flags (`category`, `isCoreProgramming`) are stripped at
 * the API boundary because the admin UI never renders them.
 */
export interface InterviewTechnology {
  name: string
}

/** One professional role pulled off the CV (most recent first). */
export interface WorkHistoryEntry {
  title: string
  company: string
  /** "YYYY-MM" | "YYYY" | "" */
  start: string
  /** "YYYY-MM" | "YYYY" | "present" | "" */
  end: string
  isTechRole: boolean
}

/** Detail-view profile slice. The list view uses a slimmer subset. */
export interface InterviewProfile {
  primaryRole: string
  /** One-line justification (from the CV) for the role verdict. Optional on
   *  rows scored before structured extraction shipped. */
  primaryRoleEvidence?: string
  /** junior | mid | senior | lead | unknown. Optional on legacy rows. */
  seniority?: string
  /** Computed server-side from work-history dates. */
  yearsOfExperience: number
  summary: string
  technologies: InterviewTechnology[]
  /** Structured roles + dates. Optional on legacy rows. */
  workHistory?: WorkHistoryEntry[]
}

/** List-view profile slice — only the two fields the table renders. */
export interface InterviewListProfile {
  primaryRole: string
  yearsOfExperience: number
}

/** Perceptual disfluency rating from the fluency judge (hears the clips). */
export type DisfluencyRating = "none" | "occasional" | "frequent"

/**
 * Deterministic temporal fluency features, pooled across ALL of the
 * candidate's answered speech (fluency is a stable trait — scored once per
 * interview, never per answer). Derived in code from word timestamps.
 * MECHANICS ONLY — no tone / accent / personality fields, by design.
 */
export interface FluencyFeatures {
  /** Pooled speaking pace, words per minute. Full marks 120–150; 0 at ≤40 / ≥230. */
  wpm: number
  /** Fraction (0–1) of speech time in inter-word gaps ≥ 0.3s. Lower is better (free ≤0.10). */
  pauseRatio: number
  /** Mean length of run — average words per uninterrupted speech run. Band 7–16. */
  mlr: number
  /** Filler-token share of total words. Fallback signal only (ASR strips most fillers). */
  fillerRate: number
  /** Total pooled speech seconds the features were derived from. */
  speechSec: number
  /** Total pooled words analysed. */
  wordCount: number
  /** How many answers contributed audio/timings to the pool. */
  answersAnalyzed: number
}

/**
 * The LLM fluency axes (0–10 each) + the perceptual disfluency rating.
 * Accent-guarded: "clear" = an attentive listener understands them, NOT
 * native-sounding; judged independent of whether the answer was correct.
 */
export interface FluencyAssessment {
  /** How reliably an attentive listener understands the speech. */
  intelligibility: number
  /** Command of English grammar + vocabulary in speech (ESL-lenient). */
  grammaticalLexicalControl: number
  /** How connectedly ideas flow as spoken language. */
  coherence: number
  disfluency: {
    rating: DisfluencyRating
    /** Short evidence phrase from the judge (may be empty). */
    evidence: string
  }
}

/**
 * Pooled spoken-English fluency breakdown — every sub-value of the
 * communication fold, so the score is fully auditable in the UI. Shipped on
 * `InterviewDetail.scores.fluency`; `null` there when fluency was skipped
 * (fold off / no scorable speech / scores persisted before the fluency split).
 */
export interface FluencyResult {
  /** 0–10 from the deterministic temporal bands; null → fluency was LLM-only. */
  temporalScore: number | null
  /** 0–10 — mean of the three LLM axes. */
  llmScore: number
  /** Final fluency 0–10: `0.35·temporal + 0.65·llm` (or `llmScore` alone). */
  fluencyScore: number
  /** Temporal features; null when no word timings were derivable. */
  features: FluencyFeatures | null
  assessment: FluencyAssessment
  /** Which judge produced the axes: audio-native (`audio`) or the text fallback. */
  llmMode: "audio" | "text"
  /** Whether answer audio was available to the fluency pipeline. */
  hasAudio: boolean
}

/**
 * Per-section (intro / technical / behavioral / approach / cultural) score
 * rollup — a stat only, does NOT feed the pass gate. Lets reviewers see how a
 * candidate did per section rather than only the single blended number.
 */
export interface CategoryScore {
  category: string
  /** Questions in this section. */
  count: number
  /** Of those, how many had a real (scorable) answer. */
  answered: number
  technical: number
  /** Per-section SUBSTANCE communication mean (fluency is interview-level). */
  communication: number
  /** Blended (same weights as the global overall), 0–10. */
  overall: number
}

/**
 * Speaking-pace stats derived from answer durations + transcript word counts.
 * Informational — not part of the pass gate. This WPM is transcript-word based
 * (distinct from `FluencyResult.features.wpm`, which is word-timestamp based
 * over a second ASR pass).
 */
export interface PacingStats {
  /** Mean words-per-minute across answered questions that had audio. */
  avgWordsPerMinute: number
  /** Mean spoken answer length in seconds across answered questions. */
  avgAnswerDurationSec: number
  /** How many answers contributed to the averages. */
  answeredWithAudio: number
}

/**
 * Scoring rubric used by the AI scorer. Mirrors the backend's
 * `OverallScores` shape one-for-one — `technicalSkills` and
 * `communication` are the only per-dimension scores the scorer
 * produces; `overall` is the weighted combination computed
 * server-side at scoring time.
 *
 * Treat `overall` as authoritative rather than recomputing
 * client-side — the weights are tuned on the backend and may
 * change without a schema bump.
 */
export interface OverallScores {
  /** 0–10. Depth, correctness, real-world awareness, trade-offs. */
  technicalSkills: number
  /**
   * 0–10 FINAL communication, post-fold:
   *   `(0.15·substance + 0.85·fluency) · g`
   * where `g` = `communicationFloor`. When fluency was skipped this is the
   * substance mean untouched. The audit sub-values below (`communicationSubstance`,
   * `fluencyScore`, `communicationFloor`) let the UI show how it was combined.
   */
  communication: number
  /**
   * The substance-only communication mean (structure/clarity/concision) that
   * went INTO the fold. Optional for backward-compat with scores persisted
   * before the fluency split.
   */
  communicationSubstance?: number
  /** The pooled fluency score folded in; null when fluency was skipped. */
  fluencyScore?: number | null
  /**
   * The substance-floor factor g (0–1) that scaled the blend; null when the
   * fold didn't run. 1 = substance cleared the bar; → 0 crushes fluent nonsense.
   */
  communicationFloor?: number | null
  /**
   * @deprecated Legacy "smart answering" dimension — removed from the
   * scoring rubric (its signal is covered by the communication
   * cluster). Only present on interviews scored before the removal;
   * never sent for newly scored ones, and no longer rendered anywhere.
   */
  smartAnswering?: number
  overall: number
  /**
   * 0–10 anti-cheat score (10 = clean) derived from proctoring signals.
   * FLAG-ONLY — it drives red flags + this readout but never auto-fails a
   * candidate. Optional: scored rows that predate this field omit it.
   */
  integrity?: number
  /** Fraction of questions actually answered (0–1). Optional on legacy rows. */
  coverage?: number
  /**
   * Binary AI verdict. Collapsed from the legacy `strong_yes | yes |
   * maybe | no` to a simple `yes | no` per the May 2026 product
   * spec; mapping is `overall >= APPLICATION_AI_PASS_THRESHOLD
   * (env-driven on backend, default 7) → "yes"`, else `"no"`. The
   * backend's `mirrorVerdictToApplicant` overrides legacy records
   * on read so the frontend can treat this as authoritative.
   *
   * The legacy 4-value tokens are tolerated on the wire (older
   * scored rows haven't been re-touched yet) — see
   * `recommendationLabels` in `features/interviews/helpers.ts`
   * which maps them to the binary equivalents at render time.
   */
  recommendation: "yes" | "no"
  strengths: string[]
  /**
   * Areas-to-improve / relative weak spots. Always populated by the backend
   * (1-3 items) so even a passing candidate shows a "weak side". Optional on
   * the wire for older scored rows that pre-date the field.
   */
  weaknesses?: string[]
  redFlags: string[]
  summary: string
  /**
   * Per-section score rollup (stat only, never gates). Optional so reads of
   * older persisted scores (written before this field) don't break.
   */
  categoryBreakdown?: CategoryScore[]
  /** Speaking-pace stats (stat only). Optional for the same backward-compat reason. */
  pacing?: PacingStats
}

/** Slim shape used in the table — only the two fields the table reads. */
export interface InterviewListOverallScores {
  overall: number
  recommendation: OverallScores["recommendation"]
}

export interface InterviewListItem {
  sessionId: string
  candidateName: string
  email: string
  status: InterviewStatus
  cvUrl: string
  /**
   * Background-scoring lifecycle for THIS (latest) attempt — lets a list row
   * badge an in-flight (re)scoring run without opening the drawer. Independent
   * of `status`. See {@link ScoringStatus}.
   */
  scoringStatus: ScoringStatus
  profile: InterviewListProfile | null
  scores: { overall: InterviewListOverallScores } | null
  submittedAt: string | null
  /**
   * 1-based attempt index of this (the latest) attempt. The list shows one
   * row per applicant (their latest attempt), so this also equals the total
   * attempt count: `> 1` means the candidate reattempted and the table
   * renders a "Reattempted" marker on the name.
   */
  attemptNumber: number
}

/**
 * One attempt summary for the detail drawer's version dropdown, returned
 * oldest to newest by `getInterviewAttempts`. Selecting one loads that
 * attempt's full `InterviewDetail` via `getInterview(sessionId)`.
 */
export interface InterviewAttempt {
  sessionId: string
  attemptNumber: number
  status: InterviewStatus
  isLatestAttempt: boolean
  submittedAt: string | null
  /** Headline score, or null when unscored / abandoned. */
  overall: number | null
  recommendation: OverallScores["recommendation"] | null
}

/**
 * Per-question scoring block, populated once the background scoring
 * worker has run against this answer. Mirrors the `ScoredAnswer`
 * shape on the backend (collapsed to admin-facing field names).
 */
export interface InterviewAnswerScores {
  technical: number
  /** Per-answer SUBSTANCE communication (mean of structure/clarity/concision). */
  communication: number
  /**
   * The three communication SUBSTANCE sub-scores (0–10, ESL-lenient) that feed
   * `communication` — surfaced so the per-question row can show WHY the
   * substance number landed where it did. Optional: absent on answers scored
   * before the substance split.
   */
  structure?: number
  clarity?: number
  concision?: number
  /**
   * @deprecated Legacy dimension — only shipped for answers scored
   * before smart answering was removed from the rubric.
   */
  smartAnswering?: number
}

/**
 * One question + the candidate's recorded answer. The canonical row
 * shape for the drawer's "Questions & answers" section — one entry
 * per question the candidate was asked, in the order they were
 * asked. Skipped questions still get a row (with a
 * `[Skipped by candidate]` transcript marker stamped by the
 * backend) so the admin can see WHICH questions were skipped, not
 * just that some were.
 *
 * NO audio URL: the audio bytes live in a private S3 bucket and
 * are not exposed through the admin dashboard. The transcript is
 * the canonical record of what the candidate said.
 */
export interface InterviewAnswer {
  questionId: string
  question: string
  /** Whisper-transcribed text. Empty until the scoring worker runs. */
  transcript: string
  /**
   * Offset (seconds) into the webcam recording when this question started
   * being asked. Powers the jump-to-question chip and the on-video caption
   * overlay. Undefined for legacy sessions that pre-date capture.
   */
  askedAtSec?: number
  /** Set once the scoring worker has graded this answer. */
  scores?: InterviewAnswerScores
  /** Per-question feedback from the scorer (free-form). */
  feedback?: string
}

/**
 * Mirror of `ApplicantStatus` from the backend's applicant schema.
 * Duplicated here so the interview drawer can render the linked
 * applicant's badge pair without taking a dep on the applicants
 * feature module.
 *
 * Kept for backward-compat reads — the drawer now renders the
 * independent `initialDecision` + `aiDecision` fields instead so it
 * can show both stage verdicts side-by-side.
 */
export type LinkedApplicantStatus =
  | "initial_pass"
  | "initial_rejection"
  | "ai_pass"
  | "ai_rejection"

/** Pre-screen verdict; mirrors `InitialDecision` from the backend. */
export type LinkedApplicantInitialDecision = "pass" | "rejection"

/**
 * AI scoring verdict; mirrors `AiDecision` from the backend. `null`
 * while the candidate hasn't been scored yet — the UI renders that
 * half of the badge pair as a muted "Pending" pill.
 */
export type LinkedApplicantAiDecision = "pass" | "rejection"

export interface LinkedApplicant {
  /** Legacy combined "latest stage" status. */
  status: LinkedApplicantStatus
  /** Pre-screen verdict, preserved across the AI stage. */
  initialDecision: LinkedApplicantInitialDecision
  /** AI verdict; `null` while the interview is pending / unscored. */
  aiDecision: LinkedApplicantAiDecision | null
  /**
   * Pre-screen rejection reason ("Less than 3 years of experience.")
   * or abandon reason ("Candidate ended the interview before
   * completing it.") — empty for applicants who passed at every
   * stage.
   */
  rejectionReason: string
}

/**
 * One uploaded answer file from the technical round. Metadata only — the
 * presigned download URL is minted on click via `getTechnicalSolutionUrl`
 * (addressed by its question + index) so the link can't go stale.
 */
export interface TechnicalSolutionFile {
  name: string
  mimeType: string
  size: number
}

/** One turn of a question's AI-coach transcript (oldest-first in the array). */
export interface TechnicalAiChatTurn {
  role: "user" | "assistant"
  text: string
  /** ISO instant the turn was recorded server-side ("" if unknown). */
  at: string
}

/**
 * Final per-question scores (admin review only, no gate). Both numbers are
 * 0-100. `aiFluency` is null (N/A) when the AI-coach chat was too thin to score.
 */
export interface TechnicalItemEvaluation {
  /** 0-100: codeWeightPct%·code + (100−codeWeightPct)%·follow-up depth (the
   *  split is admin-set per question; default 20/80). */
  technicalDepth: number
  /** 0-100, or null when the AI-coach chat was too thin to score. */
  aiFluency: number | null
  breakdown?: {
    codeScore: number
    followupScore: number
    /** Code-vs-follow-up split used for `technicalDepth`. Absent on
     *  evaluations stored before the rubric became admin-tunable (= 20). */
    codeWeightPct?: number
    code?: {
      correctness: number
      codeQuality: number
      completeness: number
      feedback: string
    } | null
    fluency?: {
      promptQuality: number
      iteration: number
      verification: number
      feedback: string
    } | null
  }
  scoredAt?: string | null
}

/**
 * One assigned question in the technical round, fully self-contained: the
 * prompt, the candidate's answer files, and that question's own AI-coach
 * transcript. An invite can carry one or more of these.
 */
export interface TechnicalQuestionItem {
  questionId: string
  /** Candidate editor modality (code-editor | canvas | notebook). */
  environment: string
  /** Free-form topic label, e.g. "ai/ml" or "mern". Display tag only. */
  type: string
  order: number
  /** True if the candidate worked this question past its own time limit. */
  timedOut?: boolean
  /** The assigned task — null if the catalog question was removed. */
  question: {
    name: string
    /** Candidate editor modality (code-editor | canvas | notebook). */
    environment: string
    /** Free-form topic label. Display tag only. */
    type: string
    difficultyLevel: string
    /** Time budget in minutes (0 = no limit). */
    timeLimit: number
  } | null
  /** The candidate's uploaded answer files for this question. */
  answerFiles: TechnicalSolutionFile[]
  /** This question's conversation with the AI coach, oldest turn first. */
  aiChat: TechnicalAiChatTurn[]
  /** Final per-question scores; null until the background scorer finishes. */
  evaluation?: TechnicalItemEvaluation | null
  /** The post-solution AI follow-up interview; null when never generated. */
  followup?: {
    /** Candidate-facing lifecycle: scoring only runs once this is "submitted". */
    status: "not_started" | "questions_ready" | "submitted"
    /** False = submission looks off-topic; the questions pivoted to the mismatch. */
    addressesTask?: boolean
    /** One-line "asked X, built Y" note; empty unless addressesTask is false. */
    relevanceNote?: string
    scoringStatus: "idle" | "queued" | "processing" | "done" | "failed"
    scoringError?: string
    /** The AI-generated follow-up questions, in order (f1…fN). */
    questions?: {
      id: string
      question: string
      difficulty?: string
    }[]
    /** Candidate's answers; `transcript` empty until scoring transcribes them. */
    answers?: {
      followupQuestionId: string
      transcript: string
      durationSec?: number
      skipped?: boolean
      hasAudio?: boolean
    }[]
    /**
     * Per-answer LLM scoring (0-10 each) + narrative, produced by the background
     * scorer. Null until `scoringStatus === "done"`. `perQuestion` is keyed by
     * `followupQuestionId`; `clarity` is the communication dimension (not shown
     * in the admin drawer).
     */
    scores?: {
      perQuestion?: {
        followupQuestionId: string
        technical: number
        depth: number
        clarity: number
        smart: number
        feedback: string
        transcript?: string
      }[]
      overall?: {
        depthSummary?: string
        strengths?: string[]
        weaknesses?: string[]
        redFlags?: string[]
      }
    } | null
  } | null
}

/** Whole-round aggregate of the per-question scores. */
export interface TechnicalRoundScore {
  /** 0-100: mean of every scored item's Technical Depth. */
  technicalDepth: number
  /** 0-100: mean of items with a non-null AI Fluency; null if none scorable. */
  aiFluency: number | null
  /** "done" once every item is scored, else "partial". */
  status: "pending" | "partial" | "done"
  scoredCount?: number
  scoredAt?: string | null
}

/**
 * The candidate's TECHNICAL round artefacts: one shared screen recording +
 * timer, and an ordered list of question items (each with its own answer files
 * and AI chat). Rendered in the drawer directly below the webcam recording.
 */
export interface TechnicalSession {
  sessionId: string
  status: string
  submittedAt: string | null
  /** Auth-gated raw screen-recording proxy URL ("" when none). */
  screenVideoUrl: string
  /** Auth-gated HLS manifest URL ("" until the transcode is ready). */
  screenHlsUrl: string
  screenHlsStatus: WebcamHlsStatus | null
  screenHlsError: string
  screenVideoDurationSec: number
  /** True if the candidate SUBMITTED with no finalized screen recording. */
  submittedWithoutRecording: boolean
  /** True if the recording exceeded the size cap (kept + flagged, not discarded). */
  recordingOversize: boolean
  /** True if finalized after the deadline, or still in-progress past it. */
  timedOut: boolean
  /** Total wall-clock budget (Σ question timeLimits), minutes. 0 = no limit. */
  totalTimeLimitMin?: number
  startedAt: string | null
  /** How long the attempt took (submitted − started, or running), in seconds. */
  elapsedSec: number
  /** The assigned questions (1…N), each with its answer files + AI chat. */
  items: TechnicalQuestionItem[]
  /** Whole-round aggregate of the per-question scores; null until any item scored. */
  roundScore?: TechnicalRoundScore | null
}

export interface InterviewDetail {
  sessionId: string
  candidateName: string
  email: string
  status: InterviewStatus
  cvUrl: string
  /** 1-based attempt index of the session being viewed (1 = first attempt). */
  attemptNumber: number
  /**
   * Linked applicant from the marketing /apply funnel. `null` for
   * legacy direct-entry sessions (started via /interview/start
   * before the funnel existed) — the drawer falls back to the
   * interview `status` field above in that case.
   */
  applicant: LinkedApplicant | null
  /**
   * Raw-recording proxy URL (`…/video`). Present only while a
   * non-transcoded original still exists (legacy records + the brief
   * window before HLS is ready). Empty once converted to HLS. Used as
   * the player's fallback before `webcamHlsUrl` is ready.
   */
  webcamVideoUrl: string
  /**
   * HLS manifest URL (`…/hls/manifest.m3u8`) streamed via hls.js. Empty
   * until the background transcode reaches `ready`.
   */
  webcamHlsUrl: string
  /** Transcode lifecycle; drives player vs. "processing…" vs. "retry" UI. */
  webcamHlsStatus: WebcamHlsStatus | null
  /** Transcode failure message (when `webcamHlsStatus === 'failed'`). */
  webcamHlsError: string
  /**
   * Authoritative recording duration in seconds, captured client-side
   * at upload time. `0` means "unknown" — typically legacy records
   * that pre-date this field; the player falls back to its own
   * (best-effort) discovery in that case.
   */
  webcamVideoDurationSec: number
  /** Times the candidate left fullscreen during the interview. */
  fullscreenExitCount: number
  /** Times the candidate's tab became hidden (switched/minimised). */
  tabHiddenCount: number
  /** Seconds the candidate ran past the 30-min limit (into the grace window); 0 if on time. */
  graceUsedSec: number
  /**
   * Times the camera `MediaStreamTrack` fired `mute` while the
   * webcam recorder was active. Each event corresponds to a window
   * during which no video frames flowed into the recording — the
   * uploaded webcam video will show a frozen frame for the duration
   * of each mute. Surfaces in the proctoring badges so a reviewer
   * who sees a frozen-looking video knows whether the camera
   * dropped (count > 0) or the issue is elsewhere.
   */
  cameraMutedCount: number
  /**
   * Background AI-scoring lifecycle for this attempt. Drives the drawer's
   * Rescore affordance: `queued` / `processing` mean a run is in flight (button
   * disabled + spinner, poll running); `failed` / `needs_review` surface
   * `scoringError` and offer a retry; `done` / `idle` allow a fresh rescore.
   * Distinct from `status`, and from `scores` (which keeps the PREVIOUS run's
   * numbers while a rescore is in flight). See {@link ScoringStatus}.
   */
  scoringStatus: ScoringStatus
  /** Short failure message when `scoringStatus` is `failed` / `needs_review`; empty otherwise. */
  scoringError: string
  profile: InterviewProfile | null
  /**
   * Full scoring record, or null if scoring hasn't run yet.
   *   - `overall` — headline dimensions + every audit sub-value (the fold
   *     inputs, `categoryBreakdown`, `pacing`, `integrity`, `coverage`).
   *   - `fluency` — pooled spoken-English breakdown (WPM/pause/MLR features,
   *     LLM axes, disfluency rating, which judge ran); `null` when fluency was
   *     skipped. Drives the "scoring details" view.
   */
  scores: {
    overall: OverallScores
    fluency: FluencyResult | null
  } | null
  /**
   * Per-question rows — one entry per question the candidate was
   * asked, in ask order. The drawer's "Questions & answers" section
   * iterates this. Empty for legacy/synthetic interviews that never
   * persisted questions (`questions: []` on the doc).
   */
  answers: InterviewAnswer[]
  startedAt: string | null
  submittedAt: string | null
  /**
   * The candidate's TECHNICAL round (screen recording + solution files), or
   * null when none exists. Rendered below the webcam recording.
   */
  technicalSession: TechnicalSession | null
}

export interface PaginatedResponse<T> {
  data: T[]
  count: number
  page: number
  limit: number
  totalPage: number
  nextPage: number | null
}

export interface ListInterviewsParams {
  page?: number
  limit?: number
  status?: InterviewStatus
}
