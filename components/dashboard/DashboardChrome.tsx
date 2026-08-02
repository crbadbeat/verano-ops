import type { ReactNode } from "react";
import PageHeader from "@/components/ui/PageHeader";
import DateRangeControl from "./DateRangeControl";
import SiteSelector from "./SiteSelector";
import DashboardTabs from "./DashboardTabs";
import type { DateRange } from "@/lib/reporting/range";
import {
  siteSelectorOptions,
  currentSiteValue,
  type SiteScope,
  type DashboardTab,
} from "@/lib/reporting/scope";

/**
 * The shared cockpit header: title, the range + site controls, the cockpit tab
 * bar, and a caption stating the active window and scope. Every dashboard page
 * renders this so the controls and framing are identical across cockpits.
 */
export default function DashboardChrome({
  title,
  description,
  range,
  scope,
  tabs,
  showSite = true,
  rangeControl,
}: {
  title: string;
  description?: string;
  range?: DateRange;
  scope: SiteScope;
  tabs: DashboardTab[];
  showSite?: boolean;
  /** Overrides the default preset switcher (e.g. year-scale controls for sales). */
  rangeControl?: ReactNode;
}) {
  const scopeCaption = scope.isAll
    ? "all sites"
    : scope.warehouse
      ? scope.warehouse.name
      : "";

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Dashboards"
        title={title}
        description={description}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            {showSite && (
              <SiteSelector
                sites={siteSelectorOptions(scope)}
                current={currentSiteValue(scope)}
              />
            )}
            {rangeControl ?? (range && <DateRangeControl current={range.preset} />)}
          </div>
        }
      />
      <DashboardTabs tabs={tabs} />
      <p className="text-xs text-muted">
        {range ? `${range.label} · ${range.fromIso} → ${range.toIso}` : "Current state"}
        {scopeCaption && ` · ${scopeCaption}`}
      </p>
    </div>
  );
}
