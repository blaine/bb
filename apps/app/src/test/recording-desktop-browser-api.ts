import type {
  BbDesktopBrowserApi,
  BbDesktopBrowserAttachRequest,
  BbDesktopBrowserScopedOpenTabRequest,
  BbDesktopBrowserSetBoundsRequest,
  BbDesktopBrowserSetVisibleRequest,
  BbDesktopBrowserSnapshot,
  BbDesktopBrowserState,
} from "@bb/desktop-contract";
import {
  createBbDesktopApi,
  createNoopDesktopBrowserApi,
} from "./bb-desktop-test-utils";

export type RecordedBrowserCall =
  | { type: "attach"; request: BbDesktopBrowserAttachRequest }
  | { type: "detach"; tabId: string }
  | { type: "setBounds"; request: BbDesktopBrowserSetBoundsRequest }
  | { type: "setVisible"; request: BbDesktopBrowserSetVisibleRequest }
  | {
      type: "setVisibleWithoutFocus";
      request: BbDesktopBrowserSetVisibleRequest;
    };

export interface RecordingDesktopBrowser {
  api: BbDesktopBrowserApi;
  calls: RecordedBrowserCall[];
  attachments(): BbDesktopBrowserAttachRequest[];
  detachments(): string[];
  bounds(tabId: string): BbDesktopBrowserSetBoundsRequest["bounds"][];
  isShown(tabId: string): boolean;
  emitState(state: BbDesktopBrowserState): void;
  emitSnapshot(snapshot: BbDesktopBrowserSnapshot): void;
  emitScopedOpenTab(request: BbDesktopBrowserScopedOpenTabRequest): void;
}

const RECORDING_DESKTOP_INFO = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos" as const,
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.0-test",
};

export function createRecordingDesktopBrowser(): RecordingDesktopBrowser {
  const calls: RecordedBrowserCall[] = [];
  const stateListeners = new Set<(state: BbDesktopBrowserState) => void>();
  const snapshotListeners = new Set<
    (snapshot: BbDesktopBrowserSnapshot) => void
  >();
  const scopedOpenTabListeners = new Set<
    (request: BbDesktopBrowserScopedOpenTabRequest) => void
  >();
  const api: BbDesktopBrowserApi = {
    ...createNoopDesktopBrowserApi(),
    attach(request) {
      calls.push({ type: "attach", request });
    },
    detach(tabId) {
      calls.push({ type: "detach", tabId });
    },
    setBounds(request) {
      calls.push({ type: "setBounds", request });
    },
    setVisible(request) {
      calls.push({ type: "setVisible", request });
    },
    setVisibleWithoutFocus(request) {
      calls.push({ type: "setVisibleWithoutFocus", request });
    },
    onState(listener) {
      stateListeners.add(listener);
      return () => {
        stateListeners.delete(listener);
      };
    },
    onSnapshot(listener) {
      snapshotListeners.add(listener);
      return () => {
        snapshotListeners.delete(listener);
      };
    },
    onScopedOpenTab(listener) {
      scopedOpenTabListeners.add(listener);
      return () => {
        scopedOpenTabListeners.delete(listener);
      };
    },
  };
  return {
    api,
    calls,
    attachments: () =>
      calls.flatMap((call) => (call.type === "attach" ? [call.request] : [])),
    detachments: () =>
      calls.flatMap((call) => (call.type === "detach" ? [call.tabId] : [])),
    bounds: (tabId) =>
      calls.flatMap((call) =>
        call.type === "setBounds" && call.request.tabId === tabId
          ? [call.request.bounds]
          : [],
      ),
    isShown(tabId) {
      for (let index = calls.length - 1; index >= 0; index -= 1) {
        const call = calls[index];
        if (call === undefined || call.type === "detach") continue;
        if (call.type === "setBounds") continue;
        if (call.request.tabId === tabId) return call.request.visible;
      }
      return false;
    },
    emitState(state) {
      for (const listener of [...stateListeners]) listener(state);
    },
    emitSnapshot(snapshot) {
      for (const listener of [...snapshotListeners]) listener(snapshot);
    },
    emitScopedOpenTab(request) {
      for (const listener of [...scopedOpenTabListeners]) listener(request);
    },
  };
}

export function installRecordingDesktopBrowser(
  recording: RecordingDesktopBrowser,
): void {
  window.bbDesktop = createBbDesktopApi(RECORDING_DESKTOP_INFO, recording.api);
}
