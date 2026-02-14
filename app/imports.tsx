import { useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  useColorScheme,
  ScrollView,
  Pressable,
  FlatList,
} from "react-native";
import { useRouter } from "expo-router";
import { useImportStatus } from "../contexts/ImportContext";
import { type ImportJobState } from "../services/import/import-manager";
import { Colors, Spacing, FontSize } from "../constants/theme";

/**
 * Format an ISO timestamp to a short human-readable time.
 */
function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}

/**
 * Format elapsed seconds into a human-readable string.
 */
function formatElapsed(startIso: string, endIso?: string | null): string {
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const secs = Math.max(0, Math.round((end - start) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remainSecs}s`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hrs}h ${remainMins}m`;
}

function phaseLabel(phase: string): string {
  switch (phase) {
    case "metadata":
      return "Discovering articles";
    case "content":
      return "Extracting content";
    case "nlp":
      return "Generating summaries";
    default:
      return phase;
  }
}

function sourceLabel(source: string): string {
  switch (source) {
    case "wayback":
      return "RSS + Wayback Machine";
    case "history4feed":
      return "History4Feed";
    case "json_file":
      return "JSON file";
    default:
      return source;
  }
}

function statusIcon(status: string): string {
  switch (status) {
    case "running":
      return "⟳";
    case "completed":
      return "✓";
    case "failed":
      return "✕";
    default:
      return "•";
  }
}

/**
 * A single job card showing full import details and live log.
 */
function JobCard({
  job,
  colors,
  onDismiss,
  onViewBlog,
}: {
  job: ImportJobState;
  colors: typeof Colors.light;
  onDismiss: () => void;
  onViewBlog: () => void;
}) {
  const logRef = useRef<FlatList>(null);
  const isRunning = job.status === "running";
  const isComplete = job.status === "completed";
  const isFailed = job.status === "failed";

  const percent =
    job.totalItems > 0
      ? Math.round((job.importedItems / job.totalItems) * 100)
      : 0;

  const statusColor = isFailed
    ? colors.error
    : isComplete
    ? colors.accent
    : colors.primary;

  // Auto-scroll log to bottom when new entries arrive
  useEffect(() => {
    if (job.log.length > 0) {
      setTimeout(() => {
        logRef.current?.scrollToEnd({ animated: true });
      }, 50);
    }
  }, [job.log.length]);

  return (
    <View style={[styles.jobCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {/* Header */}
      <View style={styles.jobHeader}>
        <Text style={[styles.jobStatusIcon, { color: statusColor }]}>
          {statusIcon(job.status)}
        </Text>
        <View style={styles.jobHeaderText}>
          <Text style={[styles.jobTitle, { color: colors.text }]} numberOfLines={1}>
            {job.blogTitle}
          </Text>
          <Text style={[styles.jobMeta, { color: colors.textSecondary }]}>
            {sourceLabel(job.source)} · {formatElapsed(job.startedAt, job.completedAt)}
            {isRunning ? " elapsed" : ""}
          </Text>
        </View>
      </View>

      {/* Phase + status message */}
      <View style={styles.jobStatus}>
        <Text style={[styles.jobPhase, { color: statusColor }]}>
          {isFailed ? "Failed" : isComplete ? "Complete" : phaseLabel(job.phase)}
        </Text>
        <Text style={[styles.jobMessage, { color: colors.textSecondary }]} numberOfLines={2}>
          {job.message}
        </Text>
      </View>

      {/* Progress bar (shown when running and we have a total) */}
      {isRunning && (
        <View style={styles.progressSection}>
          <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
            <View
              style={[
                styles.progressFill,
                {
                  backgroundColor: statusColor,
                  width: job.totalItems > 0 ? `${percent}%` : "0%",
                },
              ]}
            />
            {/* Indeterminate pulse when total is unknown */}
            {job.totalItems === 0 && (
              <View style={[styles.progressIndeterminate, { backgroundColor: statusColor }]} />
            )}
          </View>
          {job.totalItems > 0 && (
            <Text style={[styles.progressText, { color: colors.textSecondary }]}>
              {job.importedItems}/{job.totalItems} ({percent}%)
            </Text>
          )}
        </View>
      )}

      {/* Live log */}
      <View style={[styles.logContainer, { backgroundColor: colors.background, borderColor: colors.border }]}>
        <Text style={[styles.logLabel, { color: colors.textSecondary }]}>Activity Log</Text>
        <FlatList
          ref={logRef}
          data={job.log}
          keyExtractor={(_, i) => String(i)}
          style={styles.logList}
          renderItem={({ item }) => (
            <Text style={[styles.logEntry, { color: colors.textSecondary }]}>
              <Text style={[styles.logTime, { color: colors.primary }]}>
                {fmtTime(item.timestamp)}
              </Text>
              {"  "}
              {item.message}
            </Text>
          )}
          nestedScrollEnabled
          showsVerticalScrollIndicator
        />
      </View>

      {/* Action buttons */}
      <View style={styles.jobActions}>
        {isComplete && job.blogId && (
          <Pressable
            style={[styles.actionButton, { backgroundColor: colors.primary }]}
            onPress={onViewBlog}
          >
            <Text style={styles.actionButtonText}>View Blog</Text>
          </Pressable>
        )}
        {(isComplete || isFailed) && (
          <Pressable
            style={[styles.actionButton, { backgroundColor: colors.border }]}
            onPress={onDismiss}
          >
            <Text style={[styles.actionButtonTextDark, { color: colors.text }]}>Dismiss</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

export default function ImportsScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === "dark" ? "dark" : "light"];
  const { jobs, dismissJob } = useImportStatus();

  const runningJobs = jobs.filter((j) => j.status === "running");
  const finishedJobs = jobs.filter((j) => j.status !== "running");

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
    >
      <Text style={[styles.title, { color: colors.text }]}>Background Tasks</Text>

      {jobs.length === 0 && (
        <View style={[styles.emptyState, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.emptyIcon]}>📭</Text>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No active imports</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            When you import a blog, you can track its progress here. Imports continue running even when you navigate away.
          </Text>
          <Pressable
            style={[styles.emptyButton, { backgroundColor: colors.primary }]}
            onPress={() => router.push("/import")}
          >
            <Text style={styles.emptyButtonText}>Import a Blog</Text>
          </Pressable>
        </View>
      )}

      {/* Running jobs first */}
      {runningJobs.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Running ({runningJobs.length})
          </Text>
          {runningJobs.map((job) => (
            <JobCard
              key={job.jobId}
              job={job}
              colors={colors}
              onDismiss={() => dismissJob(job.jobId)}
              onViewBlog={() => {
                if (job.blogId) {
                  router.push(`/blog/${job.blogId}`);
                }
              }}
            />
          ))}
        </View>
      )}

      {/* Finished jobs */}
      {finishedJobs.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Finished ({finishedJobs.length})
          </Text>
          {finishedJobs.map((job) => (
            <JobCard
              key={job.jobId}
              job={job}
              colors={colors}
              onDismiss={() => dismissJob(job.jobId)}
              onViewBlog={() => {
                if (job.blogId) {
                  dismissJob(job.jobId);
                  router.push(`/blog/${job.blogId}`);
                }
              }}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.md, paddingBottom: Spacing.xl },
  title: { fontSize: FontSize.xxl, fontWeight: "700", marginBottom: Spacing.lg },

  // Empty state
  emptyState: {
    borderRadius: 12,
    borderWidth: 1,
    padding: Spacing.lg,
    alignItems: "center",
  },
  emptyIcon: { fontSize: 40, marginBottom: Spacing.sm },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: "600", marginBottom: Spacing.xs },
  emptySubtitle: {
    fontSize: FontSize.sm,
    lineHeight: 20,
    textAlign: "center",
    marginBottom: Spacing.md,
  },
  emptyButton: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderRadius: 8,
  },
  emptyButtonText: { color: "#fff", fontWeight: "600", fontSize: FontSize.md },

  // Sections
  section: { marginBottom: Spacing.lg },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: "600", marginBottom: Spacing.sm },

  // Job card
  jobCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  jobHeader: { flexDirection: "row", alignItems: "center", marginBottom: Spacing.sm },
  jobStatusIcon: { fontSize: 20, fontWeight: "700", marginRight: Spacing.sm },
  jobHeaderText: { flex: 1 },
  jobTitle: { fontSize: FontSize.md, fontWeight: "600" },
  jobMeta: { fontSize: FontSize.xs, marginTop: 2 },

  // Status
  jobStatus: { marginBottom: Spacing.sm },
  jobPhase: { fontSize: FontSize.sm, fontWeight: "600", marginBottom: 2 },
  jobMessage: { fontSize: FontSize.xs, lineHeight: 18 },

  // Progress bar
  progressSection: { marginBottom: Spacing.sm },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
  },
  progressIndeterminate: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "30%",
    height: "100%",
    borderRadius: 3,
    opacity: 0.5,
  },
  progressText: { fontSize: FontSize.xs, marginTop: Spacing.xs },

  // Log
  logContainer: {
    borderRadius: 8,
    borderWidth: 1,
    padding: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  logLabel: { fontSize: FontSize.xs, fontWeight: "600", marginBottom: Spacing.xs },
  logList: { maxHeight: 160 },
  logEntry: { fontSize: 11, lineHeight: 16, fontFamily: "monospace" },
  logTime: { fontWeight: "600" },

  // Actions
  jobActions: { flexDirection: "row", gap: Spacing.sm },
  actionButton: {
    flex: 1,
    paddingVertical: Spacing.sm,
    borderRadius: 8,
    alignItems: "center",
  },
  actionButtonText: { color: "#fff", fontWeight: "600", fontSize: FontSize.sm },
  actionButtonTextDark: { fontWeight: "600", fontSize: FontSize.sm },
});
