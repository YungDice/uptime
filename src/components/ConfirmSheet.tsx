import type { ReactNode } from "react";
import { Capsule } from "./List";
import { Sheet } from "./Sheet";

/**
 * A question with two answers, one of which cannot be taken back.
 *
 * Stopping the clock is the only destructive thing in this app: the run is
 * filed, the counter returns to zero, and nothing brings it back - a revive
 * only exists for streaks that *lapsed*, not for ones their owner ended. It sat
 * behind a single tap, next to the button you press every day, in a row where
 * the two controls were the same size.
 *
 * Written as a question rather than a warning triangle. The answer buttons say
 * what they do, so neither of them is "OK" - which is the word people press
 * without reading.
 */
export function ConfirmSheet({
  title,
  body,
  confirmLabel,
  cancelLabel = "Keep running",
  tone = "lapse",
  onConfirm,
  onCancel,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "lapse" | "run" | "bank";
  onConfirm(): void;
  onCancel(): void;
}) {
  return (
    <Sheet label={title} onClose={onCancel}>
      <h2 className="text-title text-label">{title}</h2>
      <div className="mt-2 text-callout text-label-2">{body}</div>

      {/* Cancel first and confirm second, left to right. The destructive one is
          where the thumb is least likely to land by momentum after the tap that
          opened the sheet. */}
      <div className="mt-7 flex gap-3">
        <Capsule wide onClick={onCancel}>
          {cancelLabel}
        </Capsule>
        <Capsule wide tone={tone} onClick={onConfirm}>
          {confirmLabel}
        </Capsule>
      </div>
    </Sheet>
  );
}
