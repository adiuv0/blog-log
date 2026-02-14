import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import {
  importManager,
  type ImportJobState,
} from "../services/import/import-manager";

type ImportContextValue = {
  /** All tracked import jobs (running + recently completed/failed) */
  jobs: ImportJobState[];
  /** Whether any import is currently running */
  hasActiveImports: boolean;
  /** Start a Wayback import. Returns jobId, or null if already importing this URL. */
  startWaybackImport: (feedUrl: string) => string | null;
  /** Start a History4Feed import. Returns jobId, or null if already importing. */
  startHistory4FeedImport: (baseUrl: string, feedId: string) => string | null;
  /** Start a JSON file import. Returns jobId. */
  startJsonImport: (fileUri: string) => string | null;
  /** Dismiss a completed/failed job from the banner */
  dismissJob: (jobId: string) => void;
};

const ImportContext = createContext<ImportContextValue | null>(null);

export function ImportProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<ImportJobState[]>([]);

  useEffect(() => {
    // Initialize with current state
    setJobs(Array.from(importManager.getJobs().values()));

    // Subscribe to ImportManager changes
    const unsubscribe = importManager.subscribe((jobsMap) => {
      setJobs(Array.from(jobsMap.values()));
    });

    return unsubscribe;
  }, []);

  const value: ImportContextValue = {
    jobs,
    hasActiveImports: jobs.some((j) => j.status === "running"),
    startWaybackImport: (url) => importManager.startWaybackImport(url),
    startHistory4FeedImport: (base, feedId) =>
      importManager.startHistory4FeedImport(base, feedId),
    startJsonImport: (uri) => importManager.startJsonImport(uri),
    dismissJob: (id) => importManager.dismissJob(id),
  };

  return (
    <ImportContext.Provider value={value}>{children}</ImportContext.Provider>
  );
}

export function useImportStatus(): ImportContextValue {
  const ctx = useContext(ImportContext);
  if (!ctx) {
    throw new Error("useImportStatus must be used within an ImportProvider");
  }
  return ctx;
}
