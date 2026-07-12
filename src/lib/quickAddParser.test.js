import { describe, expect, it } from "vitest";
import { fuzzyMatchPriority, parseQuickAdd } from "./quickAddParser";

// Wed 2026-07-15 10:00 local — deterministic anchor for every case.
const NOW = new Date(2026, 6, 15, 10, 0, 0);

const PRIORITIES = [
  { id: "p_urgent", name: "Urgent" },
  { id: "p_high", name: "High" },
  { id: "p_normal", name: "Normal" },
  { id: "p_low", name: "Low" },
];

const parse = (input, extra = {}) =>
  parseQuickAdd(input, { priorities: PRIORITIES, now: NOW, ...extra });

describe("parseQuickAdd", () => {
  it("parses the kitchen-sink example", () => {
    const { title, fields } = parse("call dentist tomorrow 2pm #health !urgent every monday");
    expect(title).toBe("call dentist");
    expect(fields.due_date).toBe("2026-07-16"); // tomorrow beats the weekly anchor
    expect(fields.task_time).toBe("2:00PM");
    expect(fields.tags).toEqual(["health"]);
    expect(fields.priority_id).toBe("p_urgent");
    expect(fields.task_type).toBe("recurring");
    expect(fields.recurrence).toBe("weekly");
  });

  it("never tokenizes bare recurrence words (the every-gate)", () => {
    const { title, fields } = parse("daily standup");
    expect(title).toBe("daily standup");
    expect(fields.recurrence).toBeUndefined();
  });

  it("maps 'every month' with first-occurrence due date", () => {
    const { fields } = parse("pay rent every month");
    expect(fields.recurrence).toBe("monthly");
    expect(fields.task_type).toBe("recurring");
    expect(fields.due_date).toBe("2026-07-15"); // today anchors bare periods
  });

  it("weekday = nearest occurrence, today counts", () => {
    expect(parse("email sam friday").fields.due_date).toBe("2026-07-17");
    expect(parse("email sam wednesday").fields.due_date).toBe("2026-07-15"); // NOW is a Wednesday
    expect(parse("email sam monday").fields.due_date).toBe("2026-07-20");
  });

  it("double quotes protect literal text and are stripped from the title", () => {
    const { title, fields } = parse('review "monday report" tuesday');
    expect(title).toBe("review monday report");
    expect(fields.due_date).toBe("2026-07-21"); // tuesday, not monday
  });

  it("24h times require a colon; bare numbers stay literal", () => {
    expect(parse("lunch 14:30").fields.task_time).toBe("2:30PM");
    const eggs = parse("buy 12 eggs");
    expect(eggs.fields.task_time).toBeUndefined();
    expect(eggs.title).toBe("buy 12 eggs");
  });

  it("month-day rolls past dates into next year", () => {
    expect(parse("dentist jun 12").fields.due_date).toBe("2027-06-12");
    expect(parse("dentist aug 12").fields.due_date).toBe("2026-08-12");
    expect(parse("dentist 12 aug").fields.due_date).toBe("2026-08-12");
  });

  it("month names without an adjacent day stay literal", () => {
    const { title, fields } = parse("pay may invoice");
    expect(title).toBe("pay may invoice");
    expect(fields.due_date).toBeUndefined();
  });

  it("parses time ranges incl. meridiem inheritance and flip", () => {
    const gym = parse("gym 6-7am").fields;
    expect(gym.task_time).toBe("6:00AM");
    expect(gym.task_end_time).toBe("7:00AM");
    const mixed = parse("focus 2pm-3:30pm").fields;
    expect(mixed.task_time).toBe("2:00PM");
    expect(mixed.task_end_time).toBe("3:30PM");
    const flip = parse("shift 11-1pm").fields;
    expect(flip.task_time).toBe("11:00AM");
    expect(flip.task_end_time).toBe("1:00PM");
  });

  it("fuzzy-matches priorities; below threshold stays literal", () => {
    expect(parse("ship it !urg").fields.priority_id).toBe("p_urgent");
    expect(parse("ship it !hgih").fields.priority_id).toBe("p_high"); // 2-swap typo
    const miss = parse("ship it !zzz");
    expect(miss.fields.priority_id).toBeUndefined();
    expect(miss.title).toBe("ship it !zzz");
  });

  it("collects multiple tags incl. quoted multi-word tags", () => {
    const { fields, title } = parse('plan #trip #"deep work"');
    expect(fields.tags).toEqual(["trip", "deep work"]);
    expect(title).toBe("plan");
  });

  it("parses custom day lists with sorted day indices", () => {
    const { fields } = parse("gym every mon,wed,fri");
    expect(fields.recurrence).toBe("custom_days");
    expect(fields.recurrence_days).toEqual([1, 3, 5]);
    expect(fields.due_date).toBe("2026-07-15"); // Wed is the nearest of the set
  });

  it("honors ignoredTokens (chips' keep-as-text)", () => {
    const { title, fields } = parse("email sam friday", {
      ignoredTokens: new Set(["date:friday"]),
    });
    expect(title).toBe("email sam friday");
    expect(fields.due_date).toBeUndefined();
  });

  it("last date wins; earlier one stays in the title", () => {
    const { title, fields } = parse("move monday to friday");
    expect(fields.due_date).toBe("2026-07-17"); // friday
    expect(title).toBe("move monday to");
  });

  it("a time implies today when no date is given", () => {
    const { fields } = parse("standup 9am");
    expect(fields.task_time).toBe("9:00AM");
    expect(fields.due_date).toBe("2026-07-15");
  });

  it("'at N' resolves bare hours; afternoons for small numbers", () => {
    expect(parse("call mom at 2").fields.task_time).toBe("2:00PM");
    expect(parse("call mom at 9").fields.task_time).toBe("9:00AM");
  });

  it("'next week' lands on next Monday", () => {
    expect(parse("plan sprint next week").fields.due_date).toBe("2026-07-20");
  });

  it("possessive weekday names stay literal", () => {
    const { fields, title } = parse("review monday's numbers");
    expect(fields.due_date).toBeUndefined();
    expect(title).toBe("review monday's numbers");
  });

  it("empty-title inputs still parse fields", () => {
    const { title, fields } = parse("tomorrow 2pm #errands");
    expect(title).toBe("");
    expect(fields.due_date).toBe("2026-07-16");
  });
});

describe("fuzzyMatchPriority", () => {
  it("ranks exact > prefix > substring", () => {
    const ps = [
      { id: "a", name: "High" },
      { id: "b", name: "Highest" },
    ];
    expect(fuzzyMatchPriority("high", ps)?.id).toBe("a");
    expect(fuzzyMatchPriority("highe", ps)?.id).toBe("b");
  });

  it("returns null for empty or unmatched queries", () => {
    expect(fuzzyMatchPriority("", PRIORITIES)).toBe(null);
    expect(fuzzyMatchPriority("qq", PRIORITIES)).toBe(null);
  });
});
