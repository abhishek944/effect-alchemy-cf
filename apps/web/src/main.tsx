import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { registerBrowserCollectors } from "@/lib/browser-diagnostics";
import { RootErrorBoundary } from "./root-error-boundary";

registerBrowserCollectors();

const root = document.getElementById("root");
if (!root) throw new Error("Missing app root element");

createRoot(root).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>,
);
