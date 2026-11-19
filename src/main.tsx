import React from "react";
import ReactDOM from "react-dom/client";
import { api } from "./api";
import App from "./App";
import { toLanguage } from "./i18n";
import "./styles.css";

// Resolved before the first render so no screen flashes in the wrong language
api
  .getSystemLanguage()
  .catch(() => "en")
  .then((systemLanguage) =>
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <App systemLanguage={toLanguage(systemLanguage)} />
      </React.StrictMode>
    )
  );
