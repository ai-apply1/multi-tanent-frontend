/**
 * Wire types for the admin interview review surface
 * (`/admin/interviews/*`). Mirrors `admin-interviews.service.ts`'s exported
 * response contracts — that service ships ONLY what's declared there, so
 * anything absent here is genuinely not on the wire.
 */

/** Candidate-facing lifecycle of one attempt. */
export type InterviewStatus = "pending" | "in_progress" | "submitted" | "expired"

/**
 * Background AI-scoring lifecycle for a submitted attempt. INDEPENDENT of
 * `InterviewStatus`:
 *   idle          — no scoring run has been queued for this attempt
 *   queued        — a (re)scoring job is enqueued, worker hasn't picked it up
 *   processing    — the scoring pipeline is running
 *   done          — scoring completed; `scores` is populated
 *   failed        — the run errored (`scoringError` set; retryable via rescore)
 *   needs_review  — transcription was unreliable, so NO decision was finalized
 *                   (`scoringError` explains why). NOT the same as `failed`:
 *                   the pipeline declined to score rather than crashed, and
 *                   auto-scoring the blanks as 0 would unfairly reject a real
 *                   candidate. The drawer renders it distinctly (amber) for
 *                   exactly that reason — don't collapse the two.
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
 * Lifecycle of the background webcam → HLS transcode that makes the recording
 * streamable in the drawer:
 *   pending     — recording present, transcode queued
 *   processing  — transcode in flight
 *   ready       — HLS bundle available (`webcamHlsUrl` populated)
 *   failed      — transcode failed (`recording.hlsError` set; retryable)
 *
 * ⚠️ `recording.hlsStatus` has NO schema default — it is UNSET until the
 * transcode is first queued. The detail mapper coalesces that to `null`, but
 * treat `undefined` as equally possible and always compare explicitly rather
 * than relying on falsiness.
 */
export type WebcamHlsStatus = "pending" | "processing" | "ready" | "failed"

/** AI hiring verdict. Bands are derived from the job's `rejectionThreshold`. */
export type Recommendation = "strong_yes" | "yes" | "no"

/** Perceptual disfluency rating from the fluency judge (hears the clips). */
export type DisfluencyRating = "none" | "occasional" | "frequent"

// ---------------------------------------------------------------------------
// Scoring
//
// NOTE: there is no profile type here. The parsed-CV profile lives on the
// CANDIDATE document, not the interview — the drawer resolves it from
// `AdminInterviewDetail.candidateId` via `features/candidates`, which already
// owns `CandidateProfile` and the `["candidate", id]` cache entry.
// ---------------------------------------------------------------------------

/**
 * Deterministic temporal fluency features, pooled across ALL of the
 * candidate's answered speech (fluency is a stable trait — scored once per
 * interview, never per answer). Derived in code from word timestamps.
 * MECHANICS ONLY — no tone / accent / personality fields, by design.
 */
export interface FluencyFeatures {
  /** Pooled speaking pace, words per minute. */
  wpm: number
  /** Fraction (0–1) of speech time in inter-word gaps ≥ 0.3s. Lower is better. */
  pauseRatio: number
  /** Mean length of run — average words per uninterrupted speech run. */
  mlr: number
  /** Filler-token share of total words. Fallback signal only (ASR strips most). */
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
  intelligibility: number
  grammaticalLexicalControl: number
  coherence: number
  disfluency: {
    rating: DisfluencyRating
    /** Short evidence phrase from the judge (may be empty). */
    evidence: string
  }
}

/**
 * Pooled spoken-English fluency breakdown — every sub-value of the
 * communication fold, so the score is fully auditable. `null` when fluency was
 * skipped (fold off / no scorable speech).
 */
export interface FluencyResult {
  /** 0–10 from the deterministic temporal bands; null → fluency was LLM-only. */
  temporalScore: number | null
  /** 0–10 — mean of the three LLM axes. */
  llmScore: number
  /** Final fluency 0–10: `0.35·temporal + 0.65·llm` (or `llmScore` alone). */
  fluencyScore: number
  features: FluencyFeatures | null
  assessment: FluencyAssessment
  /** Which judge produced the axes: audio-native (`audio`) or the text fallback. */
  llmMode: "audio" | "text"
  hasAudio: boolean
}

/**
 * Speaking-pace stats derived from answer durations + transcript word counts.
 * Informational — not part of the pass gate.
 */
export interface PacingStats {
  avgWordsPerMinute: number
  avgAnswerDurationSec: number
  answeredWithAudio: number
}

/**
 * Anti-cheat signal derived from the proctoring counters.
 *
 * ⚠️ An OBJECT, not a number — `buildInterviewScores` persists
 * `{ score, flags }`. `flags` is already merged into `qualitative.redFlags`
 * by the backend, so rendering both duplicates them.
 */
export interface InterviewIntegrity {
  /** 0–10, 10 = clean. FLAG-ONLY: surfaced to HR, never auto-fails. */
  score: number
  /** Human-readable proctoring concerns; empty unless the score is low. */
  flags: string[]
}

/**
 * One question's scoring detail from the LLM judge — the authoritative
 * per-answer breakdown. `questions[].score` on the detail is only the headline
 * blend (`(technical + communication) / 2`), so the drawer joins this in by
 * `questionId` to show the components.
 */
export interface ScoredAnswer {
  questionId: string
  /** The wording that was actually asked (this candidate's variant). */
  text: string
  transcript: string
  /** Per-answer technical/substance correctness, 0–10. */
  technical: number
  /** Per-answer SUBSTANCE communication: mean of structure/clarity/concision. */
  communication: number
  feedback: string
  /** Communication sub-scores, 0–10 each. Skipped answers carry 0. */
  structure?: number
  clarity?: number
  concision?: number
  /** Spoken length in seconds; null/absent when there was no audio. */
  durationSec?: number | null
  /**
   * The HR-set percent of the score the aggregator applied to this answer.
   * Totals 100 across the interview's questions.
   */
  weight?: number
}

/**
 * The LLM's qualitative narrative. NOTE the split: `summary` is hoisted to
 * `InterviewScores.summary` by `buildInterviewScores` and is NOT repeated here,
 * and `redFlags` already has the proctoring integrity flags appended.
 */
export interface QualitativeEval {
  strengths: string[]
  /**
   * Areas to improve — always populated (1-3 items) even for strong
   * candidates. Distinct from `redFlags`: normal development areas vs serious
   * concerns.
   */
  weaknesses: string[]
  redFlags: string[]
}

/** The job's fold weights, snapshotted onto the scores at scoring time. */
export interface ScoringWeights {
  /** 0–100; sums to 100 with `communication` (backend-validated). */
  technical: number
  communication: number
}

/**
 * The scoring rollup persisted on `interviews.scores` (a Mixed prop). The
 * headline numbers the decision gate reads are always present; everything else
 * is audit payload that older rows may lack — hence the optionals.
 *
 * Every score is 0–10. `overall × 10` is compared against the job's 0–100
 * `rejectionThreshold` exactly once, server-side. Treat these as authoritative
 * — never recompute client-side, because the weights are per-job.
 */
export interface InterviewScores {
  /** Weighted blend: (W.technical·technical + W.communication·communication)/100. */
  overall: number
  /** Weighted per-question technical mean (skipped answers score 0). */
  technical: number
  /** Substance mean with the pooled-fluency fold applied. */
  communication: number
  recommendation: Recommendation
  summary: string
  integrity?: InterviewIntegrity
  fluency?: FluencyResult | null
  pacing?: PacingStats
  /** Fraction of questions actually answered (0–1). */
  coverage?: number
  perQuestion?: ScoredAnswer[]
  qualitative?: QualitativeEval
  /** The SUBSTANCE communication mean (pre-fold) — makes the fold auditable. */
  communicationSubstance?: number
  /**
   * The substance-floor factor g (0–1) that scaled the blend; null when the
   * fold didn't run. 1 = substance cleared the bar; → 0 crushes fluent nonsense.
   */
  communicationFloor?: number | null
  /** Snapshot of the job knobs the numbers were computed with. */
  scoringWeights?: ScoringWeights
  rejectionThreshold?: number
}

// ---------------------------------------------------------------------------
// Interview responses
// ---------------------------------------------------------------------------

export interface InterviewProctoring {
  fullscreenExitCount: number
  tabHiddenCount: number
  /** Seconds the candidate ran past the time limit (into the grace window). */
  graceUsedSec: number
}

export interface InterviewRecording {
  /** Authoritative recorder wall-clock duration (0 = unknown). */
  durationSec: number
  hlsStatus: WebcamHlsStatus | null
  hlsProgress: number
  hlsError: string
}

/**
 * One question + the candidate's recorded answer, in ask order. Skipped
 * questions still get a row (with `skipped: true` and the
 * `[Skipped by candidate]` transcript marker) so the reviewer can see WHICH
 * questions were skipped, not just that some were.
 */
export interface AdminInterviewQuestionItem {
  questionId: string
  orderIndex: number
  /**
   * WHICH of the bank question's wordings this candidate drew. Two
   * candidates for the same job differ here, never in `orderIndex`.
   */
  variantId: string
  /**
   * The exact words asked, snapshotted when the interview was prepared.
   * Display this — never look the wording up from `variantId`, or an edit
   * in the bank would rewrite what this transcript says we asked.
   */
  text: string
  /** This question's percent of the interview score, frozen from the job. */
  weightPct: number
  transcript: string
  skipped: boolean
  /** Headline per-question blend, 0–10; null until scored. */
  score: number | null
  feedback: string
  /** Offset into the recording when this question started being asked. */
  askedAtSec: number | null
  answerDurationSec: number | null
  /** Presigned GET, 10-min TTL. '' when absent or the presign failed. */
  answerAudioUrl: string
  /** Presigned GET for the pre-warmed question TTS clip, 10-min TTL. '' if none. */
  ttsAudioUrl: string
}

/**
 * One attempt summary for the detail drawer's version dropdown. Returned
 * oldest → newest by `getInterviewAttempts`.
 */
export interface AdminInterviewAttempt {
  sessionId: string
  attemptNumber: number
  status: InterviewStatus
  isLatestAttempt: boolean
  submittedAt: string | null
  /** Headline interview score, or null when unscored / expired. */
  overall: number | null
  recommendation: string | null
}

export interface AdminInterviewListItem {
  sessionId: string
  candidateName: string
  email: string
  jobId: string
  /** '' when the job row is gone. */
  jobTitle: string
  status: InterviewStatus
  scoringStatus: ScoringStatus
  /**
   * 1-based attempt index. With `latestOnly` (the default) this equals the
   * candidate's total attempt count: `> 1` means they reattempted.
   */
  attemptNumber: number
  /** Headline score slice, or null when unscored. */
  scores: { overall: number; recommendation: string } | null
  startedAt: string | null
  submittedAt: string | null
  recording: { hlsStatus: WebcamHlsStatus | null }
  proctoring: InterviewProctoring
}

/**
 * One row of `GET /admin/interviews/top-candidates` — the job overview's
 * "Top ranked candidates" leaderboard. Only completed + scored interviews,
 * highest score first. `overall` is already 0-100 (the scale the UI shows).
 */
export interface TopCandidate {
  /** publicSessionId — the interview key, if we ever deep-link the row. */
  sessionId: string
  candidateName: string
  email: string
  overall: number
  recommendation: string
  submittedAt: string | null
}

export interface AdminInterviewDetail {
  sessionId: string
  /** The candidate who sat this interview — resolves the parsed-CV profile. */
  candidateId: string
  jobId: string
  /** '' when the job row is gone. */
  jobTitle: string
  candidateName: string
  email: string
  status: InterviewStatus
  attemptNumber: number
  isLatestAttempt: boolean
  scoringStatus: ScoringStatus
  /** Short failure message when scoring `failed` / `needs_review`; else ''. */
  scoringError: string
  questions: AdminInterviewQuestionItem[]
  /** Full scoring rollup, or null when unscored. */
  scores: InterviewScores | null
  proctoring: InterviewProctoring
  recording: InterviewRecording
  /**
   * Raw-recording streaming proxy URL (`…/video`). Present only while a
   * non-transcoded original still exists — the transcode worker deletes the
   * raw copy once the HLS bundle is ready. The player's fallback source.
   */
  webcamVideoUrl: string
  /**
   * Auth-gated HLS manifest proxy URL, streamed via hls.js. Empty until the
   * background transcode reaches `ready`.
   */
  webcamHlsUrl: string
  /** Every attempt by this candidate (oldest → newest) — version dropdown. */
  attempts: AdminInterviewAttempt[]
  startedAt: string | null
  submittedAt: string | null
  expiresAt: string | null
  createdAt: string | null
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
  jobId?: string
  status?: InterviewStatus
  scoringStatus?: ScoringStatus
  /** Substring match on candidateName | email. */
  search?: string
  /**
   * Collapse to ONE row per candidate (their latest attempt). Defaults to
   * `true` server-side; pass `false` to list every attempt.
   */
  latestOnly?: boolean
  page?: number
  limit?: number
}
