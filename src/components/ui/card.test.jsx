import React from "react";
import { render, screen } from "@testing-library/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card";

describe("Card", () => {
  it("renders the DS surface: token background, hairline border, 12px radius, hover shadow", () => {
    render(<Card data-testid="card">content</Card>);
    const card = screen.getByTestId("card");
    expect(card.className).toContain("bg-surface-card");
    expect(card.className).toContain("border-border-hairline");
    expect(card.className).toContain("rounded-xl");
    expect(card.className).toContain("hover:shadow-sm");
  });

  it("merges a consumer className without losing the surface", () => {
    render(<Card data-testid="card" className="p-6">x</Card>);
    const card = screen.getByTestId("card");
    expect(card.className).toContain("p-6");
    expect(card.className).toContain("bg-surface-card");
  });

  it("composes header, title, description, and content", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Quiet title</CardTitle>
          <CardDescription>Soft supporting line</CardDescription>
        </CardHeader>
        <CardContent>Body</CardContent>
      </Card>
    );

    const title = screen.getByText("Quiet title");
    expect(title.tagName).toBe("H3");
    expect(title.className).toContain("font-semibold");
    expect(screen.getByText("Soft supporting line").tagName).toBe("P");
    expect(screen.getByText("Body")).not.toBe(null);
  });
});
