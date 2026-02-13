import { View, Text, StyleSheet, useColorScheme, ScrollView } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { db } from "../../db/client";
import { Colors, Spacing, FontSize } from "../../constants/theme";

function useStats() {
  return useQuery({
    queryKey: ["stats"],
    queryFn: async () => {
      const totalArticles = db.$client.getFirstSync(
        `SELECT COUNT(*) as count FROM articles`
      ) as { count: number } | null;

      const readArticles = db.$client.getFirstSync(
        `SELECT COUNT(*) as count FROM reading_progress WHERE status = 'read'`
      ) as { count: number } | null;

      const inProgressArticles = db.$client.getFirstSync(
        `SELECT COUNT(*) as count FROM reading_progress WHERE status = 'in_progress'`
      ) as { count: number } | null;

      const totalWordsRead = db.$client.getFirstSync(
        `SELECT COALESCE(SUM(a.word_count), 0) as total
         FROM articles a
         JOIN reading_progress rp ON a.id = rp.article_id
         WHERE rp.status = 'read'`
      ) as { total: number } | null;

      const totalReadingTime = db.$client.getFirstSync(
        `SELECT COALESCE(SUM(duration_seconds), 0) as total FROM reading_sessions`
      ) as { total: number } | null;

      const totalBlogs = db.$client.getFirstSync(
        `SELECT COUNT(*) as count FROM blogs`
      ) as { count: number } | null;

      // Reading streak: count consecutive days with at least one article completed
      const completedDates = db.$client.getAllSync(
        `SELECT DISTINCT date(completed_at) as day
         FROM reading_progress
         WHERE status = 'read' AND completed_at IS NOT NULL
         ORDER BY day DESC`
      ) as Array<{ day: string }>;

      let streak = 0;
      if (completedDates.length > 0) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (let i = 0; i < completedDates.length; i++) {
          const dayDate = new Date(completedDates[i].day);
          dayDate.setHours(0, 0, 0, 0);

          const expectedDate = new Date(today);
          expectedDate.setDate(expectedDate.getDate() - i);
          expectedDate.setHours(0, 0, 0, 0);

          if (dayDate.getTime() === expectedDate.getTime()) {
            streak++;
          } else if (i === 0 && dayDate.getTime() === expectedDate.getTime() - 86400000) {
            // Allow streak to include yesterday if nothing today yet
            streak++;
            today.setDate(today.getDate() - 1);
          } else {
            break;
          }
        }
      }

      return {
        totalArticles: totalArticles?.count ?? 0,
        readArticles: readArticles?.count ?? 0,
        inProgressArticles: inProgressArticles?.count ?? 0,
        totalWordsRead: totalWordsRead?.total ?? 0,
        totalReadingTimeSeconds: totalReadingTime?.total ?? 0,
        totalBlogs: totalBlogs?.count ?? 0,
        streak,
      };
    },
  });
}

function StatCard({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: typeof Colors.light;
}) {
  return (
    <View style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.statValue, { color: colors.primary }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{label}</Text>
    </View>
  );
}

export default function StatsScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === "dark" ? "dark" : "light"];
  const { data: stats } = useStats();

  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const formatWords = (words: number) => {
    if (words >= 1000000) return `${(words / 1000000).toFixed(1)}M`;
    if (words >= 1000) return `${(words / 1000).toFixed(1)}K`;
    return String(words);
  };

  if (!stats) return null;

  const completionPct =
    stats.totalArticles > 0
      ? Math.round((stats.readArticles / stats.totalArticles) * 100)
      : 0;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
    >
      <Text style={[styles.title, { color: colors.text }]}>Reading Stats</Text>

      <View style={styles.grid}>
        <StatCard label="Articles Read" value={String(stats.readArticles)} colors={colors} />
        <StatCard label="Total Articles" value={String(stats.totalArticles)} colors={colors} />
        <StatCard label="Completion" value={`${completionPct}%`} colors={colors} />
        <StatCard label="Streak" value={`${stats.streak} day${stats.streak !== 1 ? "s" : ""}`} colors={colors} />
        <StatCard label="Words Read" value={formatWords(stats.totalWordsRead)} colors={colors} />
        <StatCard label="Time Reading" value={formatTime(stats.totalReadingTimeSeconds)} colors={colors} />
        <StatCard label="In Progress" value={String(stats.inProgressArticles)} colors={colors} />
        <StatCard label="Blogs Tracked" value={String(stats.totalBlogs)} colors={colors} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.md },
  title: { fontSize: FontSize.xxl, fontWeight: "700", marginBottom: Spacing.lg },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  statCard: {
    width: "48%",
    borderRadius: 12,
    padding: Spacing.md,
    borderWidth: 1,
    alignItems: "center",
  },
  statValue: { fontSize: FontSize.xl, fontWeight: "700", marginBottom: Spacing.xs },
  statLabel: { fontSize: FontSize.sm },
});
