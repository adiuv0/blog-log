/**
 * ImportManager — module-level singleton that owns import lifecycle.
 *
 * Import Promises live in this module's closure, not in any React component,
 * so they survive screen navigation. The React layer subscribes via a simple
 * callback pattern (see ImportContext).
 */

import type { QueryClient } from "@tanstack/react-query";
import { importFromWayback } from "./wayback-fetcher";
import { importFromHistory4Feed } from "./history4feed-api";
import { importFromJsonFile } from "./json-import";
import { generateId, type ImportProgress } from "./utils";

export type ImportJobState = {
  jobId: string;
  blogId: string | null;
  blogTitle: string;
  source: "wayback" | "history4feed" | "json_file";
  status: "running" | "completed" | "failed";
  phase: string;
  totalItems: number;
  importedItems: number;
  message: string;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
};

type Listener = (jobs: Map<string, ImportJobState>) => void;

class ImportManager {
  private jobs: Map<string, ImportJobState> = new Map();
  private listeners: Listener[] = [];
  private queryClient: QueryClient | null = null;
  private autoDismissTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  /**
   * Called once from root layout to give the manager access to QueryClient.
   */
  setQueryClient(qc: QueryClient): void {
    this.queryClient = qc;
  }

  /**
   * Subscribe to state changes. Returns an unsubscribe function.
   */
  subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /**
   * Get current snapshot of all tracked jobs.
   */
  getJobs(): Map<string, ImportJobState> {
    return this.jobs;
  }

  /**
   * Whether any import is currently running.
   */
  hasActiveImports(): boolean {
    for (const job of this.jobs.values()) {
      if (job.status === "running") return true;
    }
    return false;
  }

  /**
   * Start a Wayback Machine import. Returns immediately with the jobId.
   */
  startWaybackImport(feedUrl: string): string {
    const jobId = generateId();
    this.initJob(jobId, feedUrl, "wayback");

    importFromWayback(feedUrl, (progress) => {
      this.handleProgress(jobId, progress);
    })
      .then((blogId) => this.handleComplete(jobId, blogId))
      .catch((err) => this.handleError(jobId, err));

    return jobId;
  }

  /**
   * Start a History4Feed import. Returns immediately with the jobId.
   */
  startHistory4FeedImport(baseUrl: string, feedId: string): string {
    const jobId = generateId();
    this.initJob(jobId, baseUrl, "history4feed");

    importFromHistory4Feed(baseUrl, feedId, (progress) => {
      this.handleProgress(jobId, progress);
    })
      .then((blogId) => this.handleComplete(jobId, blogId))
      .catch((err) => this.handleError(jobId, err));

    return jobId;
  }

  /**
   * Start a JSON file import. Returns immediately with the jobId.
   */
  startJsonImport(fileUri: string): string {
    const jobId = generateId();
    this.initJob(jobId, "JSON file", "json_file");

    importFromJsonFile(fileUri, (progress) => {
      this.handleProgress(jobId, progress);
    })
      .then((blogId) => this.handleComplete(jobId, blogId))
      .catch((err) => this.handleError(jobId, err));

    return jobId;
  }

  /**
   * Remove a completed/failed job from the tracked list.
   */
  dismissJob(jobId: string): void {
    const timer = this.autoDismissTimers.get(jobId);
    if (timer) {
      clearTimeout(timer);
      this.autoDismissTimers.delete(jobId);
    }
    this.jobs.delete(jobId);
    this.notify();
  }

  // ── Internal ──────────────────────────────────────────────────────

  private initJob(
    jobId: string,
    displayName: string,
    source: ImportJobState["source"]
  ): void {
    this.jobs.set(jobId, {
      jobId,
      blogId: null,
      blogTitle: displayName,
      source,
      status: "running",
      phase: "metadata",
      totalItems: 0,
      importedItems: 0,
      message: "Starting import...",
      error: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
    });
    this.notify();
  }

  private handleProgress(jobId: string, progress: ImportProgress): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.phase = progress.phase;
    job.totalItems = progress.total;
    job.importedItems = progress.imported;
    job.message = progress.message;
    if (progress.blogTitle) {
      job.blogTitle = progress.blogTitle;
    }
    this.notify();
  }

  private handleComplete(jobId: string, blogId: string | null): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.status = "completed";
    job.blogId = blogId;
    job.completedAt = new Date().toISOString();
    job.message = `Import complete! ${job.importedItems} articles imported.`;
    this.notify();

    // Invalidate blog list so Library screen updates
    this.queryClient?.invalidateQueries({ queryKey: ["blogs"] });

    // Auto-dismiss completed jobs after 10 seconds
    const timer = setTimeout(() => {
      this.autoDismissTimers.delete(jobId);
      this.dismissJob(jobId);
    }, 10_000);
    this.autoDismissTimers.set(jobId, timer);
  }

  private handleError(jobId: string, err: unknown): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    const message = err instanceof Error ? err.message : String(err);
    job.status = "failed";
    job.error = message;
    job.completedAt = new Date().toISOString();
    job.message = `Import failed: ${message}`;
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.jobs);
      } catch {
        // Listener error should not break the manager
      }
    }
  }
}

export const importManager = new ImportManager();
