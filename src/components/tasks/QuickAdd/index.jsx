// @ts-nocheck
/**
 * @file QuickAdd — the natural-language task input. Type
 * `call dentist tomorrow 2pm #health !urgent every monday`, watch the
 * chips confirm what was understood, press Enter, keep typing the next
 * one. `#`/`!` open a dropdown of the user's actual tag/priority names
 * (typed-trigger completion — nothing to mistype).
 *
 * Chip dismissal carries intent:
 * - natural-language chips (date/time/recurrence): X = "keep as text" —
 *   the match is suppressed via ignoredTokens and stays in the title.
 * - sigil chips (#tag/!priority): X = remove — the token text is
 *   spliced out of the input (keeping "#health" as title text is never
 *   what anyone wants).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns/format";
import { CalendarDays, Clock, Repeat, Tag, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { parseQuickAdd } from "@/lib/quickAddParser";
import { colorDot } from "@/lib/colors";
import { cn } from "@/lib/utils";
import TokenAutocomplete from "./TokenAutocomplete";
import { useTokenCompletion } from "./useTokenCompletion";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dateLabel(dateStr, now = new Date()) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((date - today) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  return format(date, "EEE, MMM d");
}

function recurrenceLabel(value) {
  const { recurrence, recurrence_days, anchorDay } = value;
  if (recurrence === "daily") return "Every day";
  if (recurrence === "weekdays") return "Every weekday";
  if (recurrence === "weekly") return anchorDay != null ? `Every ${DAY_NAMES[anchorDay]}` : "Every week";
  if (recurrence === "biweekly") return "Every 2 weeks";
  if (recurrence === "monthly") return "Every month";
  if (recurrence === "quarterly") return "Every quarter";
  if (recurrence === "yearly") return "Every year";
  if (recurrence === "custom_days") return `Every ${(recurrence_days || []).map((d) => DAY_NAMES[d]).join(", ")}`;
  return "Repeats";
}

function Chip({ icon: Icon, dot, label, onDismiss, testId }) {
  return (
    <Badge
      variant="secondary"
      className="gap-1.5 pr-1.5 font-medium text-slate-600 dark:text-slate-300"
      data-testid={testId}
    >
      {dot ? <span className={cn("w-2 h-2 rounded-full", dot)} /> : Icon ? <Icon className="w-3 h-3" /> : null}
      {label}
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onDismiss}
        className="rounded hover:text-slate-900 dark:hover:text-slate-100"
        aria-label={`Remove ${label}`}
      >
        <X className="w-3 h-3" />
      </button>
    </Badge>
  );
}

export default function QuickAdd({ open, onOpenChange, priorities = [], savedTags = [], onCreate }) {
  const [value, setValue] = useState("");
  const [ignored, setIgnored] = useState(() => new Set());
  const inputRef = useRef(null);

  const completion = useTokenCompletion({ value, setValue, inputRef, priorities, savedTags });

  const parsed = useMemo(
    () => parseQuickAdd(value, { priorities, ignoredTokens: ignored }),
    [value, priorities, ignored]
  );

  // Prune ignores whose raw text no longer appears — fresh text, fresh parse.
  useEffect(() => {
    if (!ignored.size) return;
    const lower = value.toLowerCase();
    const stale = [...ignored].filter((key) => !lower.includes(key.slice(key.indexOf(":") + 1)));
    if (stale.length) {
      setIgnored((prev) => {
        const next = new Set(prev);
        stale.forEach((k) => next.delete(k));
        return next;
      });
    }
  }, [value, ignored]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  if (!open) return null;

  const canSubmit = parsed.title.trim().length > 0;

  const submit = async () => {
    if (!canSubmit) return;
    const data = {
      title: parsed.title,
      status: "todo",
      task_type: parsed.fields.task_type || "one_time",
      ...parsed.fields,
    };
    setValue("");
    setIgnored(new Set());
    await onCreate(data);
    inputRef.current?.focus();
  };

  const dismissChip = (token) => {
    if (token.type === "tag" || token.type === "priority") {
      // Sigil chips: remove the token text itself.
      setValue((v) => (v.slice(0, token.start) + v.slice(token.end)).replace(/\s{2,}/g, " "));
    } else {
      // NL chips: keep the text, suppress the interpretation.
      setIgnored((prev) => new Set(prev).add(`${token.type}:${token.raw.toLowerCase()}`));
    }
    inputRef.current?.focus();
  };

  const timeChipLabel = parsed.fields.task_end_time
    ? `${parsed.fields.task_time} – ${parsed.fields.task_end_time}`
    : parsed.fields.task_time;

  return (
    <div className="relative" data-testid="quickadd">
      <Input
        ref={inputRef}
        value={value}
        placeholder='Try "call dentist tomorrow 2pm #health" — # tags, ! priority, "quotes" keep text literal'
        data-testid="quickadd-input"
        onChange={(e) => {
          setValue(e.target.value);
          completion.trackCaret(e);
        }}
        onKeyUp={completion.trackCaret}
        onClick={completion.trackCaret}
        onKeyDown={(e) => {
          if (completion.handleKeyDown(e)) return; // dropdown consumed it
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onOpenChange(false);
          }
        }}
      />
      <TokenAutocomplete
        open={completion.open}
        items={completion.items}
        activeIndex={completion.activeIndex}
        onHover={completion.setActiveIndex}
        onSelect={completion.accept}
      />

      {(parsed.tokens.length > 0 || value.trim()) && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          {parsed.tokens.map((token) => {
            if (token.type === "date") {
              return <Chip key={`${token.type}-${token.start}`} icon={CalendarDays} label={dateLabel(token.value)} onDismiss={() => dismissChip(token)} testId="quickadd-chip-date" />;
            }
            if (token.type === "time") {
              return <Chip key={`${token.type}-${token.start}`} icon={Clock} label={timeChipLabel} onDismiss={() => dismissChip(token)} testId="quickadd-chip-time" />;
            }
            if (token.type === "recurrence") {
              return <Chip key={`${token.type}-${token.start}`} icon={Repeat} label={recurrenceLabel(token.value)} onDismiss={() => dismissChip(token)} testId="quickadd-chip-recurrence" />;
            }
            if (token.type === "priority") {
              const p = priorities.find((x) => x.id === token.value.id);
              return <Chip key={`${token.type}-${token.start}`} dot={colorDot[p?.color] || colorDot.slate} label={token.value.name} onDismiss={() => dismissChip(token)} testId="quickadd-chip-priority" />;
            }
            return <Chip key={`${token.type}-${token.start}`} icon={Tag} label={token.value} onDismiss={() => dismissChip(token)} testId="quickadd-chip-tag" />;
          })}
          {!canSubmit && value.trim() && (
            <span className="text-[11px] text-slate-400 dark:text-slate-500">Add a few words for the title.</span>
          )}
        </div>
      )}
    </div>
  );
}
