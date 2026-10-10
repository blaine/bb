// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@bb/shared-ui/context-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { useIsBrowserDimmingModalOpen } from "@/hooks/useBrowserDimmingModal";
import { BROWSER_DIMMING_OVERLAYS } from "@/test/browser-dimming-overlays";

function DimProbe() {
  return (
    <span data-testid="dim">
      {useIsBrowserDimmingModalOpen() ? "dimmed" : "clear"}
    </span>
  );
}

function dimState(): string | null {
  return screen.getByTestId("dim").textContent;
}

afterEach(cleanup);

describe.each(BROWSER_DIMMING_OVERLAYS)("$name", (overlay) => {
  it("dims the in-app browser only while open", async () => {
    const view = render(
      <>
        {overlay.element(false)}
        <DimProbe />
      </>,
    );
    expect(dimState()).toBe("clear");

    view.rerender(
      <>
        {overlay.element(true)}
        <DimProbe />
      </>,
    );
    await waitFor(() => expect(dimState()).toBe("dimmed"));

    view.rerender(
      <>
        {overlay.element(false)}
        <DimProbe />
      </>,
    );
    await waitFor(() => expect(dimState()).toBe("clear"));
  });
});

it("stops dimming when Escape closes a context menu", async () => {
  render(
    <>
      <ContextMenu>
        <ContextMenuTrigger>Target</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem>Copy</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <DimProbe />
    </>,
  );
  fireEvent.contextMenu(screen.getByText("Target"));
  await waitFor(() => expect(dimState()).toBe("dimmed"));
  fireEvent.keyDown(document.activeElement ?? document.body, {
    key: "Escape",
  });
  await waitFor(() => expect(dimState()).toBe("clear"));
});

it("never dims the in-app browser for a tooltip", async () => {
  render(
    <>
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger>Tip</TooltipTrigger>
          <TooltipContent>Hint</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DimProbe />
    </>,
  );
  await screen.findAllByText("Hint");
  expect(dimState()).toBe("clear");
});
