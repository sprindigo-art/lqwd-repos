import { COMPARE_CONFIG } from "@/lib/scorecard/config";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface OutlierMarkerProps {
  /** Cohort backend, interpolated into the tooltip copy (UI-SPEC verbatim). */
  backend: "lnd" | "ldk";
}

/**
 * D-12: the MAD outlier marker is a SEPARATE third signal that never alters
 * the absolute grade. Presentation moved from the violet badge to plain amber
 * mono text per the console-panels sketch finding ("fleet-outlier marker
 * (amber)") — no glyph, no box. The tooltip threshold reads the live
 * COMPARE_CONFIG.madN knob — the single tuning surface (D-02), never a
 * hardcoded copy.
 */
export function OutlierMarker({ backend }: OutlierMarkerProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="font-mono text-xs font-semibold tracking-[0.06em] whitespace-nowrap text-status-warn">
            fleet outlier
          </span>
        </TooltipTrigger>
        <TooltipContent>
          More than {COMPARE_CONFIG.madN} MADs from the {backend} cohort median on this dimension.
          This does not change the grade.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
