import { useCallback, useEffect, useRef } from "react";
import type { BbDesktopBrowserTarget } from "@bb/desktop-contract";
import { usePointerCoarse } from "@bb/shared-ui/hooks/use-pointer-coarse";
import {
  BrowserView,
  type BrowserViewHandle,
  type BrowserViewNavigation,
} from "@/components/browser/BrowserView";
import {
  takeBrowserViewRecreation,
  type BrowserViewVisibilityCoordinator,
} from "./browserViewVisibilityCoordinator";
import type { UpdateBrowserTabArgs } from "./useThreadFileTabs";

interface BrowserTabContentProps {
  tabId: string;
  desktopTarget?: BbDesktopBrowserTarget;
  existingOnly?: true;
  initialUrl: string;
  addressFocusRequest: BrowserAddressFocusRequest | null;
  onAddressFocusRequestConsumed?: (request: BrowserAddressFocusRequest) => void;
  canShowNativeBrowserView: boolean;
  canHandleBrowserCommands?: boolean;
  onNativeFocus?: () => void;
  visibilityCoordinator: BrowserViewVisibilityCoordinator | null;
  environmentId: string | null;
  threadId: string;
  onUpdate: (args: UpdateBrowserTabArgs) => void;
  onOpenInNewTab: ((url: string) => void) | null;
}

export interface BrowserAddressFocusRequest {
  requestId: number;
  tabId: string;
}

const PANEL_BROWSER_UNAVAILABLE_COPY = {
  title: "Browser tabs need the desktop app",
  body: "The in-app web browser runs in the bb desktop app. Open this thread there to browse the web.",
};

export function BrowserTabContent({
  tabId,
  desktopTarget,
  existingOnly,
  initialUrl,
  addressFocusRequest,
  onAddressFocusRequestConsumed,
  canShowNativeBrowserView,
  canHandleBrowserCommands = canShowNativeBrowserView,
  onNativeFocus,
  visibilityCoordinator,
  environmentId,
  threadId,
  onUpdate,
  onOpenInNewTab,
}: BrowserTabContentProps) {
  const browserViewRef = useRef<BrowserViewHandle>(null);
  const isPointerCoarse = usePointerCoarse();
  const existingOnlyRef = useRef(existingOnly);
  const desktopTargetRef = useRef(desktopTarget);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const shouldAttachExistingOnly = useCallback(() => {
    const target = desktopTargetRef.current;
    return (
      existingOnlyRef.current === true &&
      (target === undefined || !takeBrowserViewRecreation(tabId, target))
    );
  }, [tabId]);

  const handleNavigate = useCallback(
    ({ url, title }: BrowserViewNavigation) => {
      onUpdateRef.current({ tabId, url, title });
    },
    [tabId],
  );

  useEffect(() => {
    if (addressFocusRequest === null || addressFocusRequest.tabId !== tabId) {
      return;
    }
    if (isPointerCoarse) {
      onAddressFocusRequestConsumed?.(addressFocusRequest);
      return;
    }
    browserViewRef.current?.beginAddressEdit();
    const frame = requestAnimationFrame(() => {
      browserViewRef.current?.focusAddressInput();
      onAddressFocusRequestConsumed?.(addressFocusRequest);
    });
    return () => cancelAnimationFrame(frame);
  }, [
    addressFocusRequest,
    isPointerCoarse,
    onAddressFocusRequestConsumed,
    tabId,
  ]);

  return (
    <BrowserView
      ref={browserViewRef}
      viewId={tabId}
      ownerId={threadId}
      environmentId={environmentId}
      initialUrl={initialUrl}
      chrome="full"
      canShow={canShowNativeBrowserView}
      canHandleBrowserCommands={canHandleBrowserCommands}
      visibilityCoordinator={visibilityCoordinator}
      shouldAttachExistingOnly={shouldAttachExistingOnly}
      unavailableCopy={PANEL_BROWSER_UNAVAILABLE_COPY}
      onNavigate={handleNavigate}
      onOpenTab={null}
      onOpenInNewTab={onOpenInNewTab}
      onNativeFocus={onNativeFocus ?? null}
    />
  );
}
