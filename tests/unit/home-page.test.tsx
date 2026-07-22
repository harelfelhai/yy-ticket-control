import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "@/app/page";
import { he } from "@/lib/he";

describe("דף השער", () => {
  it("מציג את שם המערכת ככותרת ראשית", () => {
    render(<HomePage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(he.app.name);
  });

  it("שואב את הטקסטים מקובץ המחרוזות ולא מקודד אותם בקומפוננטה", () => {
    render(<HomePage />);
    expect(screen.getByText(he.app.description)).toBeInTheDocument();
  });
});
