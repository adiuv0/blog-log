import { View, Text, StyleSheet, useColorScheme, Switch, ScrollView } from "react-native";
import { useState } from "react";
import { Colors, Spacing, FontSize } from "../../constants/theme";

export default function SettingsScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === "dark" ? "dark" : "light"];
  const [offlineReader, setOfflineReader] = useState(false);
  const [autoMarkRead, setAutoMarkRead] = useState(true);

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

      <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>About</Text>
        <Text style={[styles.aboutText, { color: colors.textSecondary }]}>
          Blog Log helps you systematically read through blog archives. Articles open on the author's original site by default.
        </Text>
        <Text style={[styles.version, { color: colors.textSecondary }]}>
          Version 1.0.0
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
  aboutText: { fontSize: FontSize.sm, lineHeight: 20, marginBottom: Spacing.sm },
  version: { fontSize: FontSize.xs },
});
