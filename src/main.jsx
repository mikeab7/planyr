import React from "react";
import { createRoot } from "react-dom/client";
import Shell from "./app/Shell.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Shell />
  </React.StrictMode>
);
