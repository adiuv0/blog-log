import { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  useColorScheme,
  FlatList,
} from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useBlog } from "../../../hooks/useBlogs";
import {
  useArticles,
  type ArticleWithProgress,
  type FilterStatus,
  type SortField,
  type SortDirection,
} from "../../../hooks/useArticles";
import { useCycleReadingStatus } from "../../../hooks/useReadingProgress";
import { useSummaryGeneration } from "../../../hooks/useSummaryGeneration";
import { Colors, Spacing, FontSize } from "../../../constants/theme";

const STATUS_ICONS: Record<string, string> = {
  unread: "\u25CB",       // empty circle
  in_progress: "\u25D0",  // half circle
  read: "\u25CF",          // filled circle
};

function ArticleCard({
  article,
  colors,
  onPress,
  onStatusPress,
}: {
  article: ArticleWithProgress;
  colors: typeof Colors.light;
  onPress: () => void;
  onStatusPress: () => void;
}) {
  const statusColor =
    article.status === "read"
      ? colors.read
      : article.status === "in_progress"
      ? colors.inProgress
      : colors.unread;

  const dateStr = article.pubdate
    ? new Date(article.pubdate).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;

  return (
    <Pressable
      style={[styles.articleCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onPress={onPress}
    >
      <View style={styles.articleRow}>
        <Pressable onPress={onStatusPress} style={styles.statusButton} hitSlop={8}>
          <Text style={[styles.statusIcon, { color: statusColor }]}>
            {STATUS_ICONS[article.status]}
          </Text>
        </Pressable>

        <View style={styles.articleInfo}>
          <Text
            style={[
              styles.articleTitle,
              { color: colors.text },
              article.status === "read" && styles.articleTitleRead,
            ]}
            numberOfLines={2}
          >
            {article.title}
          </Text>

          <View style={styles.metaRow}>
            {dateStr && (
              <Text style={[styles.metaText, { color: colors.textSecondary }]}>{dateStr}</Text>
            )}
            {article.readingTimeMinutes > 0 && (
              <Text style={[styles.metaText, { color: colors.textSecondary }]}>
                {article.readingTimeMinutes} min read
              </Text>
            )}
            {article.author && (
              <Text style={[styles.metaText, { color: colors.textSecondary }]} numberOfLines={1}>
                {article.author}
              </Text>
            )}
          </View>

          {article.summary && (
            <Text style={[styles.summaryText, { color: colors.textSecondary }]} numberOfLines={2}>
              {article.summary}
            </Text>
          )}

          {article.tags.length > 0 && (
            <View style={styles.tagRow}>
              {article.tags.slice(0, 3).map((tag) => (
                <View
                  key={tag}
                  style={[styles.tag, { backgroundColor: colors.border }]}
                >
                  <Text style={[styles.tagText, { color: colors.textSecondary }]}>{tag}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const FILTER_OPTIONS: { label: string; value: FilterStatus }[] = [
  { label: "All", value: "all" },
  { label: "Unread", value: "unread" },
  { label: "Reading", value: "in_progress" },
  { label: "Read", value: "read" },
];

export default function ArticleListScreen() {
  const { blogId } = useLocalSearchParams<{ blogId: string }>();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === "dark" ? "dark" : "light"];

  const [filter, setFilter] = useState<FilterStatus>("all");
  const [sortField] = useState<SortField>("pubdate");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [searchQuery, setSearchQuery] = useState("");

  const { data: blog } = useBlog(blogId);
  const { data: articleList, isLoading } = useArticles(blogId, {
    filter,
    sortField,
    sortDirection,
    searchQuery: searchQuery.length >= 2 ? searchQuery : undefined,
  });
  const { cycle } = useCycleReadingStatus();

  // Generate TextRank summaries in background
  useSummaryGeneration(blogId);

  const handleArticlePress = useCallback(
    (article: ArticleWithProgress) => {
      const linkParam = article.link
        ? `&link=${encodeURIComponent(article.link)}`
        : "";
      router.push(`/blog/${blogId}/article?articleId=${article.id}${linkParam}`);
    },
    [blogId, router]
  );

  const renderItem = useCallback(
    ({ item }: { item: ArticleWithProgress }) => (
      <ArticleCard
        article={item}
        colors={colors}
        onPress={() => handleArticlePress(item)}
        onStatusPress={() => cycle(item.id, item.status)}
      />
    ),
    [colors, handleArticlePress, cycle]
  );

  return (
    <>
      <Stack.Screen options={{ title: blog?.title ?? "Articles" }} />

      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <TextInput
            style={[
              styles.searchInput,
              { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border },
            ]}
            placeholder="Search articles..."
            placeholderTextColor={colors.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>

        {/* Filter Bar */}
        <View style={styles.filterRow}>
          {FILTER_OPTIONS.map((opt) => (
            <Pressable
              key={opt.value}
              style={[
                styles.filterChip,
                {
                  backgroundColor: filter === opt.value ? colors.primary : colors.surface,
                  borderColor: filter === opt.value ? colors.primary : colors.border,
                },
              ]}
              onPress={() => setFilter(opt.value)}
            >
              <Text
                style={[
                  styles.filterText,
                  { color: filter === opt.value ? "#fff" : colors.textSecondary },
                ]}
              >
                {opt.label}
              </Text>
            </Pressable>
          ))}

          <Pressable
            style={[styles.sortButton, { borderColor: colors.border }]}
            onPress={() => setSortDirection((d) => (d === "asc" ? "desc" : "asc"))}
          >
            <Text style={[styles.sortText, { color: colors.textSecondary }]}>
              {sortDirection === "asc" ? "Oldest" : "Newest"}
            </Text>
          </Pressable>
        </View>

        {/* Article List */}
        <FlatList
          data={articleList}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: Spacing.md }}
          initialNumToRender={20}
          maxToRenderPerBatch={20}
          windowSize={5}
          ListEmptyComponent={
            !isLoading ? (
              <View style={styles.emptyState}>
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  {searchQuery ? "No articles match your search." : "No articles found."}
                </Text>
              </View>
            ) : null
          }
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchContainer: { paddingHorizontal: Spacing.md, paddingTop: Spacing.sm },
  searchInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: Spacing.sm,
    fontSize: FontSize.md,
  },
  filterRow: {
    flexDirection: "row",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.xs,
    alignItems: "center",
  },
  filterChip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: 16,
    borderWidth: 1,
  },
  filterText: { fontSize: FontSize.xs, fontWeight: "500" },
  sortButton: {
    marginLeft: "auto",
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: 16,
    borderWidth: 1,
  },
  sortText: { fontSize: FontSize.xs },
  articleCard: {
    borderRadius: 8,
    padding: Spacing.sm,
    marginBottom: Spacing.sm,
    borderWidth: 1,
  },
  articleRow: { flexDirection: "row" },
  statusButton: { paddingRight: Spacing.sm, paddingTop: 2 },
  statusIcon: { fontSize: 20 },
  articleInfo: { flex: 1 },
  articleTitle: { fontSize: FontSize.md, fontWeight: "500", lineHeight: 22 },
  articleTitleRead: { opacity: 0.6 },
  metaRow: { flexDirection: "row", gap: Spacing.sm, marginTop: 2 },
  metaText: { fontSize: FontSize.xs },
  summaryText: { fontSize: FontSize.sm, marginTop: Spacing.xs, lineHeight: 18 },
  tagRow: { flexDirection: "row", gap: Spacing.xs, marginTop: Spacing.xs },
  tag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  tagText: { fontSize: FontSize.xs },
  emptyState: { padding: Spacing.xl, alignItems: "center" },
  emptyText: { fontSize: FontSize.md },
});
