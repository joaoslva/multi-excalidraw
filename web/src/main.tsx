import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { api, parseTree } from "./api";
import "./styles.css";

declare global {
  interface Window {
    __BOOT__?: unknown;
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}

// Fonts are copied into dist/excalidraw/fonts; without this Excalidraw fetches them from a CDN.
window.EXCALIDRAW_ASSET_PATH = "/excalidraw/";

const tree = window.__BOOT__ !== undefined ? parseTree(window.__BOOT__) : await api.tree();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App initial={tree} />
  </StrictMode>,
);
