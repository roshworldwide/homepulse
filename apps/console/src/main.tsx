import { StrictMode, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { ErrorBoundary } from "./ui/ErrorBoundary";

// One bundle per page: the public break-in page never downloads the MCP client the phones use.
const path = window.location.pathname.replace(/\/+$/, "");
const load: Promise<ComponentType> =
  path === "/alexa"
    ? import("./pages/Alexa").then((m) => m.AlexaPage)
    : path === "/break-it"
      ? import("./pages/BreakIt").then((m) => m.BreakItPage)
      : import("./pages/Console").then((m) => m.ConsolePage);

void load.then((Page) =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ErrorBoundary>
        <Page />
      </ErrorBoundary>
    </StrictMode>,
  ),
);
