import { SaveButton, TrackButton } from "./save-button";

/** Save + track controls for one opportunity. Public pages are static: the real state is filled in by the browser after load. */
export function PlanPanel({ opportunityId, title, slug }: { opportunityId: string; title: string; slug: string }) {
  const returnTo = `/opportunities/${slug}`;
  return (
    <div className="space-y-3" data-testid="plan-panel">
      <SaveButton opportunityId={opportunityId} title={title} returnTo={returnTo} variant="full" />
      <TrackButton opportunityId={opportunityId} returnTo={returnTo} />
    </div>
  );
}
