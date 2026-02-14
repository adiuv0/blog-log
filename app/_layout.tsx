import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useColorScheme, View, Text, ActivityIndicator, StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { initializeDatabase } from "../db/client";
import { Colors } from "../constants/theme";
import { ImportProvider } from "../contexts/ImportContext";
import { importManager } from "../services/import/import-manager";
import { ImportProgressBanner } from "../components/ImportProgressBanner";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
    },
  },
});

export default function RootLayout() {
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === "dark" ? "dark" : "light"];

  useEffect(() => {
    initializeDatabase()
      .then(() => {
        setDbReady(true);
        importManager.setQueryClient(queryClient);
      })
      .catch((err) => {
        console.error("Database init failed:", err);
        setDbError(String(err));
      });
  }, []);

  if (dbError) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorText, { color: colors.error }]}>
          Failed to initialize database
        </Text>
        <Text style={[styles.errorDetail, { color: colors.textSecondary }]}>
          {dbError}
        </Text>
      </View>
    );
  }

  if (!dbReady) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
          Setting up Blog Log...
        </Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ImportProvider>
          <StatusBar style="auto" />
          <ImportProgressBanner />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.surface },
              headerTintColor: colors.text,
              contentStyle: { backgroundColor: colors.background },
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="blog/[blogId]/index"
              options={{ title: "Articles" }}
            />
            <Stack.Screen
              name="blog/[blogId]/article"
              options={{ title: "Reading", headerShown: false }}
            />
            <Stack.Screen
              name="import/index"
              options={{
                title: "Import Blog",
                presentation: "modal",
              }}
            />
          </Stack>
        </ImportProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
  },
  errorText: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
  },
  errorDetail: {
    fontSize: 14,
    textAlign: "center",
  },
});
