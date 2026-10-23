import { NavRailShell, type OpsNavItem } from "@/components/df/NavRailShell";

// Shared honest read-failure surface. Every board/detail catch block renders this
// instead of a bare <main> so a warehouse blip NEVER strands the operator without
// the nav rail (audit B2). Stays inside NavRailShell and uses df tokens only.

interface BoardErrorProps {
  /** Active nav key so the rail highlights the surface the operator came from. */
  active: string;
  /** The operator nav for this surface (keeps navigation alive on failure). */
  opsNav?: OpsNavItem[];
  /** Surface title passed through to the shell. */
  title: string;
  /** Heading line. Defaults to a generic honest failure title (echoes no key). */
  heading?: string;
  /** Body copy. Defaults to the read-only "your data is unchanged" reassurance. */
  body?: string;
}

/** In-shell read-failure state with the standard NOC treatment. */
export function BoardError({
  active,
  opsNav,
  title,
  heading = "Couldn't load this view.",
  body = "The read model is unreachable — a data-source problem, not a fleet failure. Your data is unchanged; this view is read-only. Check the warehouse connection and reload.",
}: BoardErrorProps) {
  return (
    <NavRailShell
      active={active}
      opsNav={opsNav}
      title={title}
      showViewToggle={false}
      showFleetSummary={false}
      showLivePill={false}
    >
      <div className="flex flex-col py-10">
        <h1 className="text-[23px] font-semibold text-df-ink">{heading}</h1>
        <p className="mt-4 max-w-[640px] text-[14px] leading-relaxed text-df-muted">{body}</p>
      </div>
    </NavRailShell>
  );
}
