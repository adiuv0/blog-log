import {
  View,
  Text,
  Pressable,
  StyleSheet,
  useColorScheme,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useImportStatus } from "../contexts/ImportContext";
import { Colors, Spacing, FontSize } from "../constants/theme";

export function ImportProgressBanner() {
  const { jobs, dismissJob } = useImportStatus();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === "dark" ? "dark" : "light"];
  const insets = useSafeAreaInsets();

  if (jobs.length === 0) return null;

  // Show the most recent active job, or the first completed/failed one
  const activeJob = jobs.find((j) => j.status === "running") ?? jobs[0];
  const percent =
    activeJob.totalItems > 0
      ? Math.round((activeJob.importedItems / activeJob.totalItems) * 100)
      : 0;

  const isComplete = activeJob.status === "completed";
  const isFailed = activeJob.status === "failed";
  const runningCount = jobs.filter((j) => j.status === "running").length;

  const bgColor = isFailed
    ? colors.error
    : isComplete
    ? colors.accent
    : colors.primary;

  return (
    <Pressable
      style={[styles.banner, { backgroundColor: bgColor, paddingTop: insets.top }]}
      onPress={() => {
        if (isComplete && activeJob.blogId) {
          dismissJob(activeJob.jobId);
          router.push(`/blog/${activeJob.blogId}`);
        }
      }}
    >
      <View style={styles.row}>
        {!isComplete && !isFailed && (
          <ActivityIndicator size="small" color="#fff" style={styles.spinner} />
        )}
        <View style={styles.textContainer}>
          <Text style={styles.bannerTitle} numberOfLines={1}>
            {isFailed
              ? `Import failed: ${activeJob.blogTitle}`
              : isComplete
              ? `Imported ${activeJob.blogTitle}`
              : `Importing ${activeJob.blogTitle}`}
            {runningCount > 1 ? ` (+${runningCount - 1} more)` : ""}
          </Text>
          <Text style={styles.bannerSubtitle} numberOfLines={1}>
            {isFailed
              ? activeJob.error ?? "Unknown error"
              : isComplete
              ? "Tap to view"
              : activeJob.message}
          </Text>
        </View>
        {(isComplete || isFailed) && (
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              dismissJob(activeJob.jobId);
            }}
            hitSlop={8}
            style={styles.dismissButton}
          >
            <Text style={styles.dismissText}>Dismiss</Text>
          </Pressable>
        )}
      </View>
      {!isComplete && !isFailed && activeJob.totalItems > 0 && (
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${percent}%` }]} />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: Spacing.xs,
  },
  spinner: {
    marginRight: Spacing.sm,
  },
  textContainer: {
    flex: 1,
  },
  bannerTitle: {
    color: "#fff",
    fontWeight: "600",
    fontSize: FontSize.sm,
  },
  bannerSubtitle: {
    color: "rgba(255,255,255,0.8)",
    fontSize: FontSize.xs,
    marginTop: 2,
  },
  dismissButton: {
    marginLeft: Spacing.sm,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
  },
  dismissText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: FontSize.sm,
  },
  progressBar: {
    height: 3,
    backgroundColor: "rgba(255,255,255,0.3)",
    borderRadius: 2,
    marginTop: Spacing.xs,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#fff",
    borderRadius: 2,
  },
});
