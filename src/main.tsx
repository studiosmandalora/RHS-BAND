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