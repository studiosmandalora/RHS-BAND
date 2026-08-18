import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  // Note: StrictMode is intentionally omitted — the QR camera scanner
  // double-mounts effects in dev and fights over the camera stream.
  <BrowserRouter>
    <App />
  </BrowserRouter>
);

// Register the service worker so the app can be installed and reopened reliably
// when added to the home screen (and still load when offline).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Registration is best-effort; the app still works without it.
    });
  });
}