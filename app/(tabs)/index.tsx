import { View, Text, StyleSheet, Pressable, useColorScheme, FlatList, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useBlogs, useDeleteBlog, type BlogWithStats } from "../../hooks/useBlogs";
import { Colors, Spacing, FontSize } from "../../constants/theme";

function BlogCard({
  blog,
  colors,
  onDelete,
}: {
  blog: BlogWithStats;
  colors: typeof Colors.light;
  onDelete: (blog: BlogWithStats) => void;
}) {
  const router = useRouter();
  const progress = blog.postCount > 0 ? blog.readCount / blog.postCount : 0;

  return (
    <Pressable
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onPress={() => router.push(`/blog/${blog.id}`)}
      onLongPress={() => onDelete(blog)}
      delayLongPress={500}
    >
      <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={2}>
        {blog.title}
      </Text>

      {blog.description ? (
        <Text style={[styles.cardDesc, { color: colors.textSecondary }]} numberOfLines={2}>
          {blog.description}
        </Text>
      ) : null}

      <View style={styles.progressContainer}>
        <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
          <View
            style={[
              styles.progressFill,
              {
                backgroundColor: colors.accent,
                width: `${Math.round(progress * 100)}%`,
              },
            ]}
          />
        </View>
        <Text style={[styles.progressText, { color: colors.textSecondary }]}>
          {blog.readCount} / {blog.postCount} read
        </Text>
      </View>

      {blog.inProgressCount > 0 && (
        <Text style={[styles.inProgressText, { color: colors.inProgress }]}>
          {blog.inProgressCount} in progress
        </Text>
      )}
    </Pressable>
  );
}

export default function LibraryScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === "dark" ? "dark" : "light"];
  const { data: blogList, isLoading } = useBlogs();
  const deleteBlog = useDeleteBlog();

  const handleDeleteBlog = (blog: BlogWithStats) => {
    Alert.alert(
      "Delete Blog",
      `Are you sure you want to delete "${blog.title}"? This will remove all ${blog.postCount} articles and your reading progress. This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            deleteBlog.mutate(blog.id);
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {!isLoading && (!blogList || blogList.length === 0) ? (
        <View style={styles.emptyState}>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            No blogs yet
          </Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            Import a blog archive to start tracking your reading progress.
          </Text>
          <Pressable
            style={[styles.importButton, { backgroundColor: colors.primary }]}
            onPress={() => router.push("/import")}
          >
            <Text style={styles.importButtonText}>Import Blog</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={blogList}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <BlogCard blog={item} colors={colors} onDelete={handleDeleteBlog} />
          )}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <View style={styles.header}>
              <Text style={[styles.headerTitle, { color: colors.text }]}>
                Library
              </Text>
              <Pressable
                style={[styles.addButton, { backgroundColor: colors.primary }]}
                onPress={() => router.push("/import")}
              >
                <Text style={styles.addButtonText}>+ Add</Text>
              </Pressable>
            </View>
          }
          ListFooterComponent={
            blogList && blogList.length > 0 ? (
              <Text style={[styles.hintText, { color: colors.textSecondary }]}>
                Long press a blog to delete it
              </Text>
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: { padding: Spacing.md },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  headerTitle: { fontSize: FontSize.xxl, fontWeight: "700" },
  addButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: 8,
  },
  addButtonText: { color: "#fff", fontWeight: "600", fontSize: FontSize.sm },
  card: {
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
  },
  cardTitle: { fontSize: FontSize.lg, fontWeight: "600", marginBottom: Spacing.xs },
  cardDesc: { fontSize: FontSize.sm, marginBottom: Spacing.sm },
  progressContainer: { marginTop: Spacing.sm },
  progressBar: {
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 4 },
  progressText: { fontSize: FontSize.xs, marginTop: Spacing.xs },
  inProgressText: { fontSize: FontSize.xs, marginTop: 2 },
  hintText: {
    fontSize: FontSize.xs,
    textAlign: "center",
    marginTop: Spacing.sm,
    marginBottom: Spacing.md,
    fontStyle: "italic",
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.xl,
  },
  emptyTitle: { fontSize: FontSize.xl, fontWeight: "600", marginBottom: Spacing.sm },
  emptySubtitle: {
    fontSize: FontSize.md,
    textAlign: "center",
    marginBottom: Spacing.lg,
    lineHeight: 24,
  },
  importButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: 12,
  },
  importButtonText: { color: "#fff", fontWeight: "600", fontSize: FontSize.md },
});
