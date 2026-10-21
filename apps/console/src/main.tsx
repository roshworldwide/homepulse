import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { BreakItPage } from "./BreakIt";
import { AlexaPage, ConsolePage } from "./pages";

const path = window.location.pathname.replace(/\/+$/, "");
const Page = path === "/alexa" ? AlexaPage : path === "/break-it" ? BreakItPage : ConsolePage;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
