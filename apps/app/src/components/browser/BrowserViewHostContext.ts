import { createContext } from "react";

export interface BrowserViewHost {
  canShowNativeBrowserView: boolean;
}

export const BrowserViewHostContext = createContext<BrowserViewHost>({
  canShowNativeBrowserView: true,
});
