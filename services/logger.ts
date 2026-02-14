/**
 * File-based debug logger for Blog Log.
 *
 * Writes timestamped log entries to a file on device that can be
 * shared/exported for debugging crash reports. Keeps the last
 * MAX_LOG_SIZE characters to prevent unbounded growth.
 *
 * Uses expo-file-system v19 modern API (Paths, File, Directory).
 */

import { Paths, File, Directory } from "expo-file-system";

const LOG_DIR = new Directory(Paths.document, "logs");
const LOG_FILE = new File(LOG_DIR, "bloglog-debug.log");
const MAX_LOG_SIZE = 512 * 1024; // 512 KB max

type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

class Logger {
  private buffer: string[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  /**
   * Ensure the log directory exists.
   */
  private async init(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        if (!LOG_DIR.exists) {
          LOG_DIR.create();
        }
        this.initialized = true;
      } catch (err) {
        // If we can't create the log dir, just silently fail
        console.warn("[Logger] Could not create log directory:", err);
      }
    })();

    return this.initPromise;
  }

  private formatEntry(level: LogLevel, tag: string, message: string, data?: unknown): string {
    const ts = new Date().toISOString();
    let entry = `[${ts}] ${level} [${tag}] ${message}`;
    if (data !== undefined) {
      try {
        const dataStr = typeof data === "string" ? data : JSON.stringify(data, null, 0);
        // Limit data to 2000 chars to prevent huge log entries
        entry += ` | ${dataStr.length > 2000 ? dataStr.substring(0, 2000) + "...(truncated)" : dataStr}`;
      } catch {
        entry += " | [unserializable data]";
      }
    }
    return entry;
  }

  private enqueue(entry: string): void {
    this.buffer.push(entry);

    // Debounce flush to batch writes
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flush();
        this.flushTimer = null;
      }, 1000);
    }
  }

  /**
   * Flush buffered entries to disk.
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const entries = this.buffer.splice(0);
    const chunk = entries.join("\n") + "\n";

    try {
      await this.init();
      if (!this.initialized) return;

      if (LOG_FILE.exists) {
        const existing = await LOG_FILE.text();
        if (existing.length > MAX_LOG_SIZE) {
          // Truncate: keep last half
          const trimmed = existing.substring(existing.length - MAX_LOG_SIZE / 2);
          const newlineIdx = trimmed.indexOf("\n");
          const clean = newlineIdx >= 0 ? trimmed.substring(newlineIdx + 1) : trimmed;
          LOG_FILE.write(clean + chunk);
        } else {
          LOG_FILE.write(existing + chunk);
        }
      } else {
        LOG_FILE.create();
        LOG_FILE.write(chunk);
      }
    } catch (err) {
      // Log to console as fallback
      console.warn("[Logger] Failed to write log file:", err);
    }
  }

  debug(tag: string, message: string, data?: unknown): void {
    const entry = this.formatEntry("DEBUG", tag, message, data);
    console.log(entry);
    this.enqueue(entry);
  }

  info(tag: string, message: string, data?: unknown): void {
    const entry = this.formatEntry("INFO", tag, message, data);
    console.log(entry);
    this.enqueue(entry);
  }

  warn(tag: string, message: string, data?: unknown): void {
    const entry = this.formatEntry("WARN", tag, message, data);
    console.warn(entry);
    this.enqueue(entry);
  }

  error(tag: string, message: string, data?: unknown): void {
    const entry = this.formatEntry("ERROR", tag, message, data);
    console.error(entry);
    this.enqueue(entry);
    // Flush errors immediately
    this.flush();
  }

  /**
   * Read the entire log file contents.
   */
  async readLog(): Promise<string> {
    try {
      await this.init();
      if (!LOG_FILE.exists) return "(no log file yet)";
      return await LOG_FILE.text();
    } catch {
      return "(failed to read log file)";
    }
  }

  /**
   * Get the log file URI for sharing.
   */
  getLogFileUri(): string {
    return LOG_FILE.uri;
  }

  /**
   * Clear the log file.
   */
  async clearLog(): Promise<void> {
    try {
      await this.init();
      if (LOG_FILE.exists) {
        LOG_FILE.write("");
      }
    } catch {
      // Ignore
    }
  }
}

export const logger = new Logger();
