import { useMemo } from "react";
import { ChevronRight, Filter } from "lucide-react";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import type { OverviewStat } from "@/features/overview/types";
import { cn } from "@/lib/utils";

/**
 * Opaque band fills for the funnel, indexed by stage. Bright enough that the
 * fixed dark label text stays legible in both light and dark themes; cycled if
 * there are ever more stages than colors.
 */
const BAND_COLORS = [
  "#60a5fa", // blue-400
  "#818cf8", // indigo-400
  "#a78bfa", // violet-400
  "#c084fc", // purple-400
  "#f472b6", // pink-400
  "#fb923c", // orange-400
  "#34d399", // emerald-400
  "#22d3ee", // cyan-400
];

/**
 * Smallest band width as a fraction of the mouth. The real counts span ~2.7K
 * down to single digits, so a strictly proportional neck would vanish; we floor
 * the width for readability and keep the true proportion in the label text.
 */
const MIN_BAND = 0.16;

/** Compact count matching the metric cards (2.7K, 899, ...). */
function formatCount(value: number): string {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

/** A share in [0,1] as a percent, keeping one decimal for small fractions so a
 * 0.4% stage doesn't collapse to 0%. */
function formatPercent(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0%";
  const pct = value * 100;
  const digits = pct < 10 ? 1 : 0;
  return `${pct.toFixed(digits)}%`;
}

interface Stage {
  id: string;
  title: string;
  count: number;
  color: string;
  /** True proportion of the funnel mouth (largest stage), in [0,1]. */
  share: number;
  /** Ratio to the previous stage's count, in [0,inf); 1 for the first stage. */
  step: number;
  /** Monotonic, smoothed band width used for the visual taper, in [MIN_BAND,1]. */
  width: number;
}

/**
 * Build the stages from the live, job-scoped cards: the filter cards in the
 * order the operator dragged them into, top of funnel first. Manual cards are
 * excluded — their number is typed, not counted, so it shares no denominator
 * with the rest and would misreport every conversion below it.
 *
 * The board order IS the funnel order, so renaming a card can't drop it and a
 * new stage needs no code change; reordering the grid reorders the funnel.
 *
 * Widths narrow monotonically (running minimum of the share) so the stack
 * always reads as a funnel even when a later, parallel-path stage outcounts the
 * stage above it; sqrt softens the steep first drop, and MIN_BAND keeps the deep
 * neck visible. The true, linear proportion is carried by `share` in the label,
 * so nothing is misreported.
 */
function buildStages(stats: OverviewStat[]): Stage[] {
  const ordered = stats.filter((s) => s.kind === "filter");

  const maxCount = ordered.reduce((m, s) => Math.max(m, s.count), 0);
  let runningMin = 1;
  return ordered.map((s, i) => {
    const prev = ordered[i - 1];
    const share = maxCount === 0 ? 0 : s.count / maxCount;
    const step = i === 0 || !prev || prev.count === 0 ? 1 : s.count / prev.count;
    runningMin = Math.min(runningMin, share);
    return {
      id: s.id,
      title: s.title,
      count: s.count,
      color: BAND_COLORS[i % BAND_COLORS.length],
      share,
      step,
      width: MIN_BAND + (1 - MIN_BAND) * Math.sqrt(runningMin),
    };
  });
}

/** A centered trapezoid whose top edge meets the band above and bottom edge
 * meets the band below, so the stack reads as one continuous funnel. Fills the
 * height of its row, so the funnel scales to fit the drawer without scrolling. */
function FunnelBand({ stage, next }: { stage: Stage; next?: Stage }) {
  const topW = stage.width;
  const botW = next ? next.width : stage.width;
  const lt = (100 - topW * 100) / 2;
  const rt = (100 + topW * 100) / 2;
  const lb = (100 - botW * 100) / 2;
  const rb = (100 + botW * 100) / 2;
  return (
    <div
      className="flex h-full flex-col items-center justify-center text-center transition-[clip-path] duration-500"
      style={{
        backgroundColor: stage.color,
        // Subtle top-down sheen for depth without hiding the base color.
        backgroundImage:
          "linear-gradient(180deg, rgba(255,255,255,0.22), rgba(0,0,0,0.10))",
        clipPath: `polygon(${lt}% 0, ${rt}% 0, ${rb}% 100%, ${lb}% 100%)`,
      }}
    >
      <span
        className="text-base font-bold leading-none tabular-nums"
        style={{ color: "#0f172a" }}
        title={stage.count.toLocaleString()}
      >
        {formatCount(stage.count)}
      </span>
      <span
        className="mt-0.5 text-[10px] font-semibold leading-none tabular-nums"
        style={{ color: "rgba(15,23,42,0.7)" }}
      >
        {formatPercent(stage.share)}
      </span>
    </div>
  );
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stats: OverviewStat[];
}

/**
 * Right-side drawer (same Sheet pattern as the interview detail drawer) that
 * visualizes the board's filter cards as a hiring funnel plus a horizontal
 * pipeline. Derived live from the job-scoped stat cards, so it follows the page
 * Job overlay, the card order, and every refetch for free. The body is a
 * non-scrolling flex column: the funnel bands share the leftover height so the
 * whole thing fits the drawer without a scrollbar.
 */
export function OverviewFunnelDrawer({ open, onOpenChange, stats }: Props) {
  const stages = useMemo(() => buildStages(stats), [stats]);

  const top = stages[0];
  const bottom = stages[stages.length - 1];
  const overall = !top || top.count === 0 ? 0 : (bottom?.count ?? 0) / top.count;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col p-0 sm:w-1/2 sm:max-w-none"
      >
        {/* Kept for accessibility only; the visible header is intentionally
            removed so the funnel fits without scrolling. */}
        <SheetTitle className="sr-only">Hiring funnel</SheetTitle>

        <SheetBody className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-hidden px-6 pb-6 pt-12">
          {stages.length < 2 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <Filter className="h-8 w-8 opacity-40" />
              <p className="text-sm">
                Add at least two metrics to see the flow.
              </p>
            </div>
          ) : (
            <>
              {/* Overall conversion headline. */}
              <div className="flex shrink-0 items-center justify-between gap-4 rounded-xl border border-border bg-muted/40 px-5 py-3.5">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Overall conversion
                  </p>
                  <p className="mt-1 truncate text-sm font-medium">
                    {top.title}{" "}
                    <span className="text-muted-foreground">to</span>{" "}
                    {bottom.title}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-3xl font-bold leading-none tabular-nums text-primary">
                    {formatPercent(overall)}
                  </p>
                  <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                    {formatCount(bottom.count)} of {formatCount(top.count)}
                  </p>
                </div>
              </div>

              {/* The funnel: labels on the left, continuous trapezoids on the
                  right. Rows flex to share the drawer height (no scroll). */}
              <div className="flex min-h-0 flex-1 flex-col gap-1">
                {stages.map((stage, i) => (
                  <div
                    key={stage.id}
                    className="flex min-h-0 flex-1 items-stretch gap-3"
                  >
                    <div className="flex w-44 shrink-0 flex-col justify-center text-right">
                      <span
                        className="truncate text-sm font-medium"
                        title={stage.title}
                      >
                        {stage.title}
                      </span>
                      {i > 0 ? (
                        <span
                          className={cn(
                            "text-xs font-medium tabular-nums",
                            stage.step >= 1
                              ? "text-emerald-500"
                              : "text-muted-foreground",
                          )}
                        >
                          {stage.step >= 1 ? "▲" : "▼"}{" "}
                          {formatPercent(stage.step)} of prev
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Top of funnel
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <FunnelBand stage={stage} next={stages[i + 1]} />
                    </div>
                  </div>
                ))}
              </div>

              {/* Pipeline: the same stages as a horizontal, scrollable flow. */}
              <div className="shrink-0">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Pipeline
                </p>
                <div className="flex items-stretch gap-1 overflow-x-auto pb-2">
                  {stages.map((stage, i) => (
                    <div key={stage.id} className="flex items-stretch gap-1">
                      {i > 0 ? (
                        <div className="flex shrink-0 flex-col items-center justify-center px-0.5">
                          <ChevronRight className="h-4 w-4 text-muted-foreground/60" />
                          <span className="text-[10px] tabular-nums text-muted-foreground/70">
                            {formatPercent(stage.step)}
                          </span>
                        </div>
                      ) : null}
                      <div
                        className={cn(
                          "flex w-32 shrink-0 flex-col justify-between rounded-lg border border-border bg-card p-2.5",
                          i === 0 && "border-primary/40",
                        )}
                      >
                        <div className="flex items-center gap-1.5">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: stage.color }}
                          />
                          <span
                            className="line-clamp-2 text-xs font-medium leading-snug"
                            title={stage.title}
                          >
                            {stage.title}
                          </span>
                        </div>
                        <div className="mt-2 flex items-baseline justify-between gap-1 tabular-nums">
                          <span
                            className="text-lg font-semibold leading-none"
                            title={stage.count.toLocaleString()}
                          >
                            {formatCount(stage.count)}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {formatPercent(stage.share)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
