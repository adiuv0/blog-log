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
import { ErrorBoundary } from "../components/ErrorBoundary";
import { logger } from "../services/logger";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      // Prevent query errors from being unhandled
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  },
});

// Install global unhandled error/rejection handlers
const originalHandler = ErrorUtils.getGlobalHandler();
ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
  logger.error("GlobalError", `${isFatal ? "FATAL" : "Non-fatal"} error: ${error.message}`, error.stack?.substring(0, 1000));
  // Still call the original handler
  if (originalHandler) {
    originalHandler(error, isFatal);
  }
});

export default function RootLayout() {
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === "dark" ? "dark" : "light"];

  useEffect(() => {
    logger.info("App", "Blog Log starting up");

    initializeDatabase()
      .then(() => {
        logger.info("App", "Database initialized successfully");
        setDbReady(true);
        importManager.setQueryClient(queryClient);
      })
      .catch((err) => {
        logger.error("App", "Database init failed", err instanceof Error ? err.message : String(err));
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
    <ErrorBoundary fallbackTitle="Blog Log encountered an error">
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
    </ErrorBoundary>
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
