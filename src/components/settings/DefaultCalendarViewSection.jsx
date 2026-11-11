// @ts-nocheck
/**
 * @file Default Calendar View dropdown — Day / Week / Month / Year.
 * Backs the localStorage `defaultCalendarView` key that the Calendar
 * page reads on initial mount.
 */
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingRow, SettingsSection } from "./parts";

const CALENDAR_VIEWS = ["day", "week", "month", "year"];

export default function DefaultCalendarViewSection() {
  const stored = localStorage.getItem("defaultCalendarView");
  const [selected, setSelected] = useState(CALENDAR_VIEWS.includes(stored) ? stored : "month");

  const save = (val) => {
    const next = CALENDAR_VIEWS.includes(val) ? val : "month";
    setSelected(next);
    localStorage.setItem("defaultCalendarView", next);
  };

  return (
    <SettingsSection label="Display">
      <div className="ds-list">
        <SettingRow label="Default view" hint="How the Calendar page opens">
          <Select value={selected} onValueChange={save}>
            <SelectTrigger className="w-36" aria-label="Default calendar view">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Day</SelectItem>
              <SelectItem value="week">Week</SelectItem>
              <SelectItem value="month">Month</SelectItem>
              <SelectItem value="year">Year</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
      </div>
    </SettingsSection>
  );
}
