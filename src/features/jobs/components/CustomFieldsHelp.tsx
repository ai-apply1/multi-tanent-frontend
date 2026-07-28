import { useState } from "react"
import { Info, X } from "lucide-react"

/** Answer type -> what it is for, and what it lets you check. */
const TYPE_HELP: Array<{ name: string; what: string; example: string }> = [
  {
    name: "Free text",
    what: "Anything written, in the candidate's own words. Collected and shown to you, never checked automatically, because there is no reliable way to judge a sentence. Asked of a candidate only, never read from a CV.",
    example: "Why do you want this role?",
  },
  {
    name: "Number",
    what: "A quantity. You can check it is more than, less than, or outside a range. Asked of a candidate only. Overall experience already has its own gate above, counted from the real dates on the CV rather than estimated.",
    example: "Expected salary, notice period in days, team size managed",
  },
  {
    name: "Yes / No",
    what: "One condition. You can check the answer is Yes, or is No. The only type available when reading from a CV, because almost any requirement can be phrased as one and a yes or no is what a vetting check needs.",
    example:
      "Willing to relocate? (asked) · Has hands-on AWS or Ansible experience (read from the CV)",
  },
  {
    name: "Choice list",
    what: "One answer picked from a list you write. You can check it is one of the answers you accept. Use it when the answer is really one of a few options: it stops the same answer arriving three different ways. Only offered for questions the candidate answers, never for ones read from a CV.",
    example: "Notice period: Immediate / 15 days / 1 month / 2 months or more",
  },
]

/**
 * What each type means once a field is read from the CV instead of asked.
 *
 * Worth spelling out because the controls look identical either way: a choice
 * list still shows its options, but they stop being a dropdown the candidate
 * sees and become the closed set the CV reader has to answer with.
 */
const SOURCE_HELP: Array<{ name: string; what: string }> = [
  {
    name: "Nobody is asked",
    what: "The field does not appear on the application form or in the bulk import. Candidates never see it and never learn you are checking it.",
  },
  {
    name: "Yes/No only",
    what: "Reading a CV is vetting, not looking things up, so the answer type is fixed to Yes/No. Anything you only want to READ is already on the candidate: the parsed profile above lists their role, seniority, years, skills and full history, and the CV itself is one click away.",
  },
  {
    name: "Phrase the bar",
    what: "Put the requirement into the question, since that sentence is what the CV is judged against. \"Has at least 3 years of hands-on React\" beats pulling out a number and comparing it: a CV rarely states years outright, so asking for a figure invites a guess, while asking about the bar lets the reader weigh the whole history against it.",
  },
  {
    name: "If the CV does not say",
    what: "No answer is recorded, so the condition cannot run and the candidate is parked for your review. They are never rejected for something their CV was silent about.",
  },
]

/** The three outcomes the condition picker offers. */
const GATE_HELP: Array<{ name: string; what: string }> = [
  {
    name: "Do not check this",
    what: "Collect the answer and show it on the candidate, nothing else. This is the default.",
  },
  {
    name: "Reject if",
    what: "Rejects the candidate automatically and sends the rejection email. Only ever fires on an answer we actually have.",
  },
  {
    name: "Flag for review if",
    what: "Leaves the candidate for you to decide, with the reason on their checklist. No email is sent.",
  },
]

/**
 * The custom-requirements section heading, with its "how do these work" panel.
 *
 * Owns the heading rather than sitting beside one, so the panel is a SIBLING of
 * the heading row instead of a third item inside it (a fragment here would make
 * the panel a flex child and wreck the row).
 *
 * A toggled panel rather than tooltips on each control: the answer types only
 * make sense against each other (why pick a choice list over free text?), and a
 * tooltip is unreadable at this length and unreachable on touch.
 */
export function CustomFieldsHelp() {
  const [open, setOpen] = useState(false)

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <label className="text-[13px] font-semibold text-ink">
          Your own requirements
        </label>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary underline-offset-2 hover:underline"
        >
          <Info className="h-3.5 w-3.5" strokeWidth={2} />
          How these work
        </button>
      </div>

      {open ? (
        <div className="mt-2.5 rounded-xl border border-[var(--field-border)] bg-surface-muted p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <h4 className="text-[12.5px] font-bold text-ink">Answer types</h4>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close help"
              className="-mt-1 -mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-subtle hover:bg-line hover:text-ink"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>

          <dl className="grid gap-2.5">
            {TYPE_HELP.map((t) => (
              <div key={t.name} className="grid gap-0.5 sm:grid-cols-[110px_1fr] sm:gap-3">
                <dt className="text-[12.5px] font-semibold text-ink">{t.name}</dt>
                <dd className="text-[12px] leading-relaxed text-ink-muted">
                  {t.what}
                  <span className="mt-0.5 block text-ink-subtle">
                    For example: {t.example}
                  </span>
                </dd>
              </div>
            ))}
          </dl>

          <h4 className="mt-4 mb-3 text-[12.5px] font-bold text-ink">
            When a field is read from the CV
          </h4>
          <dl className="grid gap-2.5">
            {SOURCE_HELP.map((s) => (
              <div key={s.name} className="grid gap-0.5 sm:grid-cols-[110px_1fr] sm:gap-3">
                <dt className="text-[12.5px] font-semibold text-ink">{s.name}</dt>
                <dd className="text-[12px] leading-relaxed text-ink-muted">
                  {s.what}
                </dd>
              </div>
            ))}
          </dl>

          <h4 className="mt-4 mb-3 text-[12.5px] font-bold text-ink">
            What happens when the condition is met
          </h4>
          <dl className="grid gap-2.5">
            {GATE_HELP.map((g) => (
              <div key={g.name} className="grid gap-0.5 sm:grid-cols-[110px_1fr] sm:gap-3">
                <dt className="text-[12.5px] font-semibold text-ink">{g.name}</dt>
                <dd className="text-[12px] leading-relaxed text-ink-muted">
                  {g.what}
                </dd>
              </div>
            ))}
          </dl>

          <p className="mt-3.5 border-t border-[var(--field-border)] pt-3 text-[12px] leading-relaxed text-ink-muted">
            A condition describes what is <strong className="text-ink">wrong</strong>,
            so it reads as a sentence: &ldquo;Reject if expected salary is more
            than 150,000&rdquo;. If a candidate has no answer to a field, they
            are always parked for your review, never rejected.
          </p>
        </div>
      ) : null}
    </div>
  )
}
