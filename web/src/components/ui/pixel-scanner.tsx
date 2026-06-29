import { cn } from "@/lib/utils"

const DOT_COUNT = 12
const SCAN_DURATION_MS = 1400

/**
 * PixelScanner — the in-button "listening" indicator for <VoiceButton>.
 *
 * A single bright pulse sweeps left → right across a row of pixel dots
 * (Knight-Rider / Space-Invaders style). It fills the wide ~96×20 letterbox
 * slot exposed by `<VoiceButton trailing>` instead of floating a square in it.
 * Each dot animates opacity + transform only, so the whole strip is
 * GPU-composited; staggering each dot's animation-delay across exactly one
 * cycle makes the lit window march continuously and loop with no seam.
 *
 * The sky (#7DD3FC) accent matches the LiveWaveform bars while recording and
 * sits as a cool complement on the warm red destructive button. Honors
 * `prefers-reduced-motion` via the `.pixel-scanner-dot` rules in index.css.
 */
export function PixelScanner({ className }: { className?: string }) {
  return (
    <div
      role="img"
      aria-label="Listening"
      className={cn("flex h-5 w-24 items-center justify-between px-1.5", className)}
    >
      {Array.from({ length: DOT_COUNT }).map((_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="pixel-scanner-dot block h-1 w-1 rounded-[1px]"
          style={{
            backgroundColor: "#7DD3FC",
            boxShadow: "0 0 4px rgba(125, 211, 252, 0.45)",
            animationDelay: `${(i * SCAN_DURATION_MS) / DOT_COUNT}ms`,
          }}
        />
      ))}
    </div>
  )
}
