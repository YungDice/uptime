import { useEffect, useRef, type ReactNode } from "react";

/**
 * The Clock app's sheet, as one component.
 *
 * Three things now rise from the bottom edge - sending time, confirming a
 * stop, and somebody else's profile - and each had grown its own copy of the
 * scrim, the grabber, the safe-area padding and the tap-outside handler. They
 * had already drifted apart by a few pixels of radius, which is exactly how a
 * design system stops being one.
 *
 * What is *not* here: the back-button entry. A sheet has to be dismissible by
 * Android's back gesture, and that is `useBackStack`'s job in `App` - it counts
 * open layers, and a component that pushed its own history entry on mount would
 * be a second place counting the same thing.
 */
export function Sheet({
  children,
  onClose,
  label,
  /** Fills the column rather than hugging its content. For the profile. */
  tall,
}: {
  children: ReactNode;
  onClose(): void;
  label: string;
  tall?: boolean;
}) {
  const panel = useRef<HTMLDivElement | null>(null);

  // Escape closes it. Cheap on a phone, and the difference between a usable
  // and an infuriating sheet on the desktop build, where there is no back
  // gesture and the scrim is the only other way out.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Focus moves into the panel so the keyboard and the screen reader both land
  // inside the thing that just opened rather than behind it.
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{
        // Two layers: a wash that darkens the page and a gradient that is
        // heaviest right under the sheet, so the panel looks like it is casting
        // the shadow rather than floating on a flat grey pane.
        background:
          "linear-gradient(180deg, color-mix(in srgb, var(--color-void) 45%, transparent) 0%, " +
          "color-mix(in srgb, var(--color-void) 80%, transparent) 100%)",
        backdropFilter: "blur(2px)",
        WebkitBackdropFilter: "blur(2px)",
      }}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={onClose}
    >
      <div
        ref={panel}
        tabIndex={-1}
        className={`animate-rise flex w-full max-w-md flex-col rounded-t-[26px] px-5 pt-3 outline-none ${
          tall ? "h-[88%]" : ""
        }`}
        style={{
          background: "linear-gradient(180deg, #1f1f22 0%, #151517 100%)",
          boxShadow:
            "inset 0 1px 0 0 rgb(255 255 255 / 10%), 0 -24px 60px -12px rgb(0 0 0 / 80%)",
          paddingBottom: "calc(1.75rem + env(safe-area-inset-bottom))",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-9 shrink-0 rounded-full bg-raise-2" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}
