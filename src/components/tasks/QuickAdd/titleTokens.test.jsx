import React, { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import TitleTokenInput from "./TitleTokenInput";
import { completedTokenAt, fuzzyMatchPriority } from "./titleTokens";

const PRIORITIES = [
  { id: "p-high", name: "High" },
  { id: "p-low", name: "Low" },
];
const ALL = { tags: true, priority: true };

/**
 * Natural-language scheduling in titles was removed on request: typing a
 * day or a time into a title used to reschedule the task. These pin that
 * it stays gone — a title is text, and only #/! tokens touch other fields.
 */
describe("titles are never read for dates, times or recurrence", () => {
  function Harness({ onForm }) {
    const [form, setForm] = useState({ title: "", tags: [], due_date: "", task_time: "" });
    onForm(form);
    return (
      <TitleTokenInput
        form={form}
        setForm={setForm}
        grammar={ALL}
        priorities={PRIORITIES}
        testid="title"
        onEnter={undefined}
      />
    );
  }

  /** Type character by character, the way a person does — the old parser
   *  fired on the space that ended each word. */
  const typeSlowly = (input, text) => {
    let value = "";
    for (const ch of text) {
      value += ch;
      fireEvent.change(input, { target: { value, selectionStart: value.length } });
      input.setSelectionRange(value.length, value.length);
    }
  };

  for (const phrase of [
    "Call mom thursday at 7pm ",
    "Dentist tomorrow ",
    "Standup every monday ",
    "Pay rent next week at 9:30 ",
    "Flight jun 12 2-4pm ",
  ]) {
    it(`leaves "${phrase.trim()}" alone`, () => {
      /** @type {any} */
      let latest = {};
      render(<Harness onForm={(f) => { latest = f; }} />);
      const input = /** @type {HTMLInputElement} */ (screen.getByTestId("title"));
      typeSlowly(input, phrase);

      expect(input.value).toBe(phrase);
      expect(latest.due_date).toBe("");
      expect(latest.task_time).toBe("");
      expect(latest.task_type).toBeUndefined();
      expect(latest.recurrence).toBeUndefined();
    });
  }
});

describe("completedTokenAt", () => {
  it("recognises a #tag just before the terminating space", () => {
    const text = "Call mom #family";
    expect(completedTokenAt(text, text.length, ALL)).toEqual({
      start: 9,
      end: text.length,
      fields: { tags: ["family"] },
    });
  });

  it("recognises a quoted multi-word tag", () => {
    const text = 'Plan #"road trip"';
    expect(completedTokenAt(text, text.length, ALL)?.fields).toEqual({ tags: ["road trip"] });
  });

  it("matches !priority against the user's own priority names", () => {
    const text = "Ship it !hig";
    expect(completedTokenAt(text, text.length, ALL, PRIORITIES)?.fields).toEqual({ priority_id: "p-high" });
  });

  it("leaves an unmatched !word in the title rather than guessing", () => {
    const text = "Wow !amazing";
    expect(completedTokenAt(text, text.length, ALL, PRIORITIES)).toBeNull();
  });

  it("respects the grammar", () => {
    expect(completedTokenAt("x #tag", 6, { tags: false, priority: true })).toBeNull();
    expect(completedTokenAt("x !high", 7, { tags: true, priority: false }, PRIORITIES)).toBeNull();
  });

  it("ignores ordinary words entirely", () => {
    for (const text of ["thursday", "7pm", "tomorrow", "every monday"]) {
      expect(completedTokenAt(text, text.length, ALL, PRIORITIES)).toBeNull();
    }
  });
});

describe("fuzzyMatchPriority", () => {
  it("prefers exact, then prefix, then substring", () => {
    expect(fuzzyMatchPriority("low", PRIORITIES)?.id).toBe("p-low");
    expect(fuzzyMatchPriority("hi", PRIORITIES)?.id).toBe("p-high");
    expect(fuzzyMatchPriority("igh", PRIORITIES)?.id).toBe("p-high");
  });

  it("tolerates a small typo", () => {
    expect(fuzzyMatchPriority("hihg", PRIORITIES)?.id).toBe("p-high");
  });

  it("returns null below the threshold", () => {
    expect(fuzzyMatchPriority("zzz", PRIORITIES)).toBeNull();
    expect(fuzzyMatchPriority("", PRIORITIES)).toBeNull();
  });
});
