"use client";

import { useRouter } from "next/navigation";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

interface ScorecardModalProps {
  /** Accessible dialog name (node alias / short pubkey) — rendered sr-only. */
  title: string;
  children: React.ReactNode;
}

/**
 * Client shell for the intercepted scorecard route: the server-rendered
 * ScorecardPanel arrives as children; closing (Esc / overlay / X) walks the
 * router back to the fleet view underneath. Deep links never hit this — direct
 * /{pubkey} visits render the full page instead.
 */
export function ScorecardModal({ title, children }: ScorecardModalProps) {
  const router = useRouter();

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) router.back();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="max-w-[calc(100%-2rem)] sm:max-w-3xl"
      >
        <DialogTitle className="sr-only">{title} — node scorecard</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  );
}
