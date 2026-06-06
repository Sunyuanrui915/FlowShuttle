/// <reference types="vite/client" />

import type { WorkJournalApi } from "../../shared/types";

declare global {
  interface Window {
    workJournal: WorkJournalApi;
  }
}
