import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  useColorScheme,
  ScrollView,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { listFeeds } from "../../services/import/history4feed-api";
import { useImportStatus } from "../../contexts/ImportContext";
import { Colors, Spacing, FontSize } from "../../constants/theme";

type ImportMode = "rss" | "history4feed" | "file" | null;

export default function ImportScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === "dark" ? "dark" : "light"];

  const {
    hasActiveImports,
    startWaybackImport,
    startHistory4FeedImport,
    startJsonImport,
  } = useImportStatus();

  const [mode, setMode] = useState<ImportMode>(null);
  const [rssUrl, setRssUrl] = useState("");
  const [h4fUrl, setH4fUrl] = useState("");
  const [h4fFeeds, setH4fFeeds] = useState<Array<{ id: string; title: string }>>([]);
  const [isConnecting, setIsConnecting] = useState(false);

  const handleRssImport = () => {
    if (!rssUrl.trim()) return;
    startWaybackImport(rssUrl.trim());
    router.back();
  };

  const handleH4fConnect = async () => {
    if (!h4fUrl.trim()) return;
    setIsConnecting(true);

    try {
      const feeds = await listFeeds(h4fUrl.trim());
      setH4fFeeds(feeds.map((f) => ({ id: f.id, title: f.title })));
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Could not connect to the History4Feed instance. Check the URL.";
      Alert.alert("Connection Failed", message);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleH4fImport = (feedId: string) => {
    startHistory4FeedImport(h4fUrl.trim(), feedId);
    router.back();
  };

  const handleFileImport = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/json", "text/xml", "application/xml"],
      });

      if (result.canceled || !result.assets?.[0]) return;

      startJsonImport(result.assets[0].uri);
      router.back();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert("Import Failed", message);
    }
  };

  if (mode === null) {
    return (
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content}
      >
        <Text style={[styles.title, { color: colors.text }]}>Import Blog</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Choose how to import a blog's archive.
        </Text>

        {hasActiveImports && (
          <View style={[styles.activeNote, { backgroundColor: colors.primaryLight + "22" }]}>
            <Text style={[styles.activeNoteText, { color: colors.primary }]}>
              An import is already running. You can start another one — they'll run in parallel.
            </Text>
          </View>
        )}

        <Pressable
          style={[styles.optionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={() => setMode("rss")}
        >
          <Text style={[styles.optionTitle, { color: colors.text }]}>RSS Feed URL</Text>
          <Text style={[styles.optionDesc, { color: colors.textSecondary }]}>
            Enter an RSS/ATOM feed URL. Blog Log will use the Wayback Machine to discover the full archive.
          </Text>
        </Pressable>

        <Pressable
          style={[styles.optionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={() => setMode("history4feed")}
        >
          <Text style={[styles.optionTitle, { color: colors.text }]}>History4Feed Instance</Text>
          <Text style={[styles.optionDesc, { color: colors.textSecondary }]}>
            Connect to a self-hosted History4Feed server for faster, more complete imports.
          </Text>
        </Pressable>

        <Pressable
          style={[styles.optionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={() => {
            setMode("file");
            handleFileImport();
          }}
        >
          <Text style={[styles.optionTitle, { color: colors.text }]}>Import JSON File</Text>
          <Text style={[styles.optionDesc, { color: colors.textSecondary }]}>
            Import from a JSON or XML file exported from History4Feed or shared by another user.
          </Text>
        </Pressable>
      </ScrollView>
    );
  }

  if (mode === "rss") {
    return (
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content}
      >
        <Text style={[styles.title, { color: colors.text }]}>RSS Feed Import</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Enter the RSS or ATOM feed URL for the blog. Blog Log will query the Wayback Machine for historical snapshots to build the complete archive.
        </Text>
        <Text style={[styles.warning, { color: colors.warning }]}>
          Large blogs may take 20-40 minutes to fully import. You can browse the app while the import runs in the background.
        </Text>

        <TextInput
          style={[
            styles.input,
            { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border },
          ]}
          placeholder="https://example.com/feed.xml"
          placeholderTextColor={colors.textSecondary}
          value={rssUrl}
          onChangeText={setRssUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />

        <View style={styles.buttonRow}>
          <Pressable
            style={[styles.button, { backgroundColor: colors.border }]}
            onPress={() => setMode(null)}
          >
            <Text style={[styles.buttonText, { color: colors.text }]}>Back</Text>
          </Pressable>
          <Pressable
            style={[styles.button, { backgroundColor: colors.primary }]}
            onPress={handleRssImport}
          >
            <Text style={[styles.buttonText, { color: "#fff" }]}>Import</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  if (mode === "history4feed") {
    return (
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content}
      >
        <Text style={[styles.title, { color: colors.text }]}>History4Feed</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Enter the URL of your History4Feed instance.
        </Text>

        <TextInput
          style={[
            styles.input,
            { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border },
          ]}
          placeholder="http://192.168.1.100:8002"
          placeholderTextColor={colors.textSecondary}
          value={h4fUrl}
          onChangeText={setH4fUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />

        {h4fFeeds.length === 0 ? (
          <View style={styles.buttonRow}>
            <Pressable
              style={[styles.button, { backgroundColor: colors.border }]}
              onPress={() => setMode(null)}
            >
              <Text style={[styles.buttonText, { color: colors.text }]}>Back</Text>
            </Pressable>
            <Pressable
              style={[styles.button, { backgroundColor: colors.primary, opacity: isConnecting ? 0.6 : 1 }]}
              onPress={handleH4fConnect}
              disabled={isConnecting}
            >
              <Text style={[styles.buttonText, { color: "#fff" }]}>
                {isConnecting ? "Connecting..." : "Connect"}
              </Text>
            </Pressable>
          </View>
        ) : (
          <View>
            <Text style={[styles.feedListTitle, { color: colors.text }]}>Select a feed:</Text>
            {h4fFeeds.map((feed) => (
              <Pressable
                key={feed.id}
                style={[styles.feedItem, { backgroundColor: colors.surface, borderColor: colors.border }]}
                onPress={() => handleH4fImport(feed.id)}
              >
                <Text style={[styles.feedItemText, { color: colors.text }]}>{feed.title}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.md },
  title: { fontSize: FontSize.xl, fontWeight: "700", marginBottom: Spacing.sm },
  subtitle: { fontSize: FontSize.md, lineHeight: 24, marginBottom: Spacing.md },
  warning: { fontSize: FontSize.sm, lineHeight: 20, marginBottom: Spacing.md },
  activeNote: {
    borderRadius: 8,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  activeNoteText: {
    fontSize: FontSize.sm,
    lineHeight: 20,
  },
  optionCard: {
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
  },
  optionTitle: { fontSize: FontSize.lg, fontWeight: "600", marginBottom: Spacing.xs },
  optionDesc: { fontSize: FontSize.sm, lineHeight: 20 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: Spacing.md,
    fontSize: FontSize.md,
    marginBottom: Spacing.md,
  },
  buttonRow: { flexDirection: "row", gap: Spacing.sm },
  button: {
    flex: 1,
    padding: Spacing.md,
    borderRadius: 8,
    alignItems: "center",
  },
  buttonText: { fontWeight: "600", fontSize: FontSize.md },
  feedListTitle: { fontSize: FontSize.lg, fontWeight: "600", marginTop: Spacing.md, marginBottom: Spacing.sm },
  feedItem: {
    borderRadius: 8,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
  },
  feedItemText: { fontSize: FontSize.md },
});
