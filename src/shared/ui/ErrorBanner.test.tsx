import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ErrorBanner } from "./ErrorBanner";

afterEach(cleanup);

describe("ErrorBanner (HARD-1)", () => {
  it("exige atención con role=alert y muestra SOLO el mensaje recibido", () => {
    render(<ErrorBanner message="No tenés permisos para esta operación." />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No tenés permisos para esta operación.",
    );
  });
});
