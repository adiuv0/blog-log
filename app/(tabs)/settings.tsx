import { View, Text, StyleSheet, useColorScheme, Switch, ScrollView, Pressable, Alert } from "react-native";
import { useState, useCallback } from "react";
import * as Sharing from "expo-sharing";
import { Colors, Spacing, FontSize } from "../../constants/theme";
import { logger } from "../../services/logger";

export default function SettingsScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === "dark" ? "dark" : "light"];
  const [offlineReader, setOfflineReader] = useState(false);
  const [autoMarkRead, setAutoMarkRead] = useState(true);
  const [logContent, setLogContent] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);

  const handleViewLog = useCallback(async () => {
    if (showLog) {
      setShowLog(false);
      setLogContent(null);
      return;
    }
    const content = await logger.readLog();
    setLogContent(content);
    setShowLog(true);
  }, [showLog]);

  const handleShareLog = useCallback(async () => {
    try {
      const isAvailable = await Sharing.isAvailableAsync();
      if (!isAvailable) {
        Alert.alert("Sharing not available", "File sharing is not available on this device.");
        return;
      }
      await logger.flush();
      const uri = logger.getLogFileUri();
      await Sharing.shareAsync(uri, {
        mimeType: "text/plain",
        dialogTitle: "Share Debug Log",
      });
    } catch (err) {
      Alert.alert("Share failed", err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleClearLog = useCallback(() => {
    Alert.alert(
      "Clear Debug Log",
      "Are you sure you want to clear the debug log?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => {
            await logger.clearLog();
            setLogContent("(log cleared)");
          },
        },
      ]
    );
  }, []);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
    >
      <Text style={[styles.title, { color: colors.text }]}>Settings</Text>

      <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Reading</Text>

        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={[styles.settingLabel, { color: colors.text }]}>
              Offline Reader
            </Text>
            <Text style={[styles.settingDesc, { color: colors.textSecondary }]}>
              Save article content for offline reading. When enabled, articles can be read without internet. Off by default to respect blog authors.
            </Text>
          </View>
          <Switch
            value={offlineReader}
            onValueChange={setOfflineReader}
            trackColor={{ true: colors.primary }}
          />
        </View>

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={[styles.settingLabel, { color: colors.text }]}>
              Auto-Mark as Read
            </Text>
            <Text style={[styles.settingDesc, { color: colors.textSecondary }]}>
              Automatically mark articles as read when you scroll to the bottom.
            </Text>
          </View>
          <Switch
            value={autoMarkRead}
            onValueChange={setAutoMarkRead}
            trackColor={{ true: colors.primary }}
          />
        </View>
      </View>

      {/* Debug Log Section */}
      <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Debug Log</Text>
        <Text style={[styles.settingDesc, { color: colors.textSecondary, marginBottom: Spacing.sm }]}>
          View or share the debug log to help diagnose crashes and issues.
        </Text>

        <View style={styles.buttonRow}>
          <Pressable
            style={[styles.logButton, { backgroundColor: colors.primary }]}
            onPress={handleViewLog}
          >
            <Text style={styles.logButtonText}>{showLog ? "Hide Log" : "View Log"}</Text>
          </Pressable>

          <Pressable
            style={[styles.logButton, { backgroundColor: colors.accent }]}
            onPress={handleShareLog}
          >
            <Text style={styles.logButtonText}>Share Log</Text>
          </Pressable>

          <Pressable
            style={[styles.logButton, { backgroundColor: colors.error }]}
            onPress={handleClearLog}
          >
            <Text style={styles.logButtonText}>Clear</Text>
          </Pressable>
        </View>

        {showLog && logContent !== null && (
          <ScrollView
            style={[styles.logContainer, { backgroundColor: colors.background, borderColor: colors.border }]}
            nestedScrollEnabled
          >
            <Text style={[styles.logText, { color: colors.text }]} selectable>
              {logContent || "(empty log)"}
            </Text>
          </ScrollView>
        )}
      </View>

      <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>About</Text>
        <Text style={[styles.aboutText, { color: colors.textSecondary }]}>
          Blog Log helps you systematically read through blog archives. Articles open on the author's original site by default.
        </Text>
        <Text style={[styles.version, { color: colors.textSecondary }]}>
          Version 0.3.0-alpha
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.md },
  title: { fontSize: FontSize.xxl, fontWeight: "700", marginBottom: Spacing.lg },
  section: {
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
  },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: "600", marginBottom: Spacing.md },
  settingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  settingInfo: { flex: 1, marginRight: Spacing.md },
  settingLabel: { fontSize: FontSize.md, fontWeight: "500", marginBottom: 2 },
  settingDesc: { fontSize: FontSize.sm, lineHeight: 20 },
  divider: { height: 1, marginVertical: Spacing.md },
  buttonRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  logButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: 8,
  },
  logButtonText: { color: "#fff", fontWeight: "600", fontSize: FontSize.sm },
  logContainer: {
    maxHeight: 300,
    borderWidth: 1,
    borderRadius: 8,
    padding: Spacing.sm,
  },
  logText: {
    fontSize: 11,
    fontFamily: "monospace",
    lineHeight: 16,
  },
  aboutText: { fontSize: FontSize.sm, lineHeight: 20, marginBottom: Spacing.sm },
  version: { fontSize: FontSize.xs },
});
