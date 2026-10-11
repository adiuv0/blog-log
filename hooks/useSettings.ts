import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "../db/client";
import { logger } from "../services/logger";

export type AppSettings = {
  autoMarkRead: boolean;
};

type SettingUpdate = {
  [K in keyof AppSettings]: { key: K; value: AppSettings[K] };
}[keyof AppSettings];

const DEFAULTS: AppSettings = {
  autoMarkRead: true,
};

function readSettings(): AppSettings {
  const rows = db.$client.getAllSync(`SELECT key, value FROM settings`) as Array<{
    key: string;
    value: string;
  }>;
  const settings = { ...DEFAULTS };
  for (const row of rows) {
    if (row.key in DEFAULTS) {
      try {
        (settings as Record<string, unknown>)[row.key] = JSON.parse(row.value);
      } catch {
        // Ignore a malformed value and keep the default
      }
    }
  }
  return settings;
}

/** Persisted app settings, stored in the `settings` table. */
export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: async () => readSettings(),
    placeholderData: DEFAULTS,
  });
}

export function useUpdateSetting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, value }: SettingUpdate) => {
      db.$client.runSync(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [key, JSON.stringify(value)]
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (err) => {
      logger.error("Settings", "Failed to save setting", err instanceof Error ? err.message : String(err));
    },
  });
}
