import { ClerkProvider } from "@clerk/react";
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
      <ClerkProvider publishableKey={PUBLIC_CLERK_PUBLISHABLE_KEY}>
        <App />
      </ClerkProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
