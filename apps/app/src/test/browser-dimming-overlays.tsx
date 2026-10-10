import { useEffect, useRef, type ReactElement } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@bb/shared-ui/context-menu";
import { Dialog, DialogContent, DialogTitle } from "@bb/shared-ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@bb/shared-ui/hover-card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@bb/shared-ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bb/shared-ui/select";

export interface BrowserDimmingOverlayCase {
  name: string;
  element: (open: boolean) => ReactElement;
}

function ContextMenuOpenedOnMount() {
  const triggerRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    triggerRef.current?.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 4,
        clientY: 4,
      }),
    );
  }, []);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <span ref={triggerRef}>Context target</span>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem>Copy</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export const DIALOG_OVERLAY: BrowserDimmingOverlayCase = {
  name: "Dialog",
  element: (open) => (
    <Dialog open={open}>
      <DialogContent>
        <DialogTitle>Overlay dialog</DialogTitle>
      </DialogContent>
    </Dialog>
  ),
};

export const BROWSER_DIMMING_OVERLAYS: readonly BrowserDimmingOverlayCase[] = [
  DIALOG_OVERLAY,
  {
    name: "Popover",
    element: (open) => (
      <Popover open={open}>
        <PopoverTrigger>Popover trigger</PopoverTrigger>
        <PopoverContent>Popover body</PopoverContent>
      </Popover>
    ),
  },
  {
    name: "DropdownMenu",
    element: (open) => (
      <DropdownMenu open={open}>
        <DropdownMenuTrigger>Menu trigger</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Menu item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  },
  {
    name: "ContextMenu",
    element: (open) =>
      open ? <ContextMenuOpenedOnMount /> : <span>Context target</span>,
  },
  {
    name: "Select",
    element: (open) => (
      <Select open={open} defaultValue="a">
        <SelectTrigger aria-label="Select trigger">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Option A</SelectItem>
        </SelectContent>
      </Select>
    ),
  },
  {
    name: "HoverCard",
    element: (open) => (
      <HoverCard open={open}>
        <HoverCardTrigger>Hover trigger</HoverCardTrigger>
        <HoverCardContent>Hover body</HoverCardContent>
      </HoverCard>
    ),
  },
];
