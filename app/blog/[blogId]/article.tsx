import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  useColorScheme,
} from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { WebView } from "react-native-webview";
import { useArticleContent } from "../../../hooks/useArticles";
import {
  useUpdateReadingStatus,
  useStartReadingSession,
  useEndReadingSession,
} from "../../../hooks/useReadingProgress";
import { ErrorBoundary } from "../../../components/ErrorBoundary";
import { logger } from "../../../services/logger";
import { Colors, Spacing, FontSize } from "../../../constants/theme";

function isValidUrl(url: string | null | undefined): url is string {
  if (!url || url.trim().length === 0) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function ArticleScreenInner() {
  const { articleId, link } = useLocalSearchParams<{ articleId: string; link: string }>();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme === "dark" ? "dark" : "light"];

  logger.debug("ArticleScreen", `Mounting with articleId=${articleId}, link=${link ? "present" : "absent"}`);

  const { data: article, error: articleError } = useArticleContent(articleId ?? "");
  const updateStatus = useUpdateReadingStatus();
  const startSession = useStartReadingSession();
  const endSession = useEndReadingSession();

  const sessionIdRef = useRef<number | null>(null);
  const hasStartedRef = useRef(false);
  const [loadError, setLoadError] = useState(false);
  const [hasReachedBottom, setHasReachedBottom] = useState(false);
  const [isMarkedRead, setIsMarkedRead] = useState(false);
  const [waybackUrl, setWaybackUrl] = useState<string | null>(null);

  // Log article query errors
  if (articleError) {
    logger.error("ArticleScreen", "useArticleContent query error", articleError instanceof Error ? articleError.message : String(articleError));
  }

  // Safely compute URL
  let articleUrl: string | null = null;
  try {
    const rawUrl = link ? decodeURIComponent(link) : article?.link ?? null;
    articleUrl = isValidUrl(rawUrl) ? rawUrl : null;
  } catch (err) {
    logger.error("ArticleScreen", "URL decode error", err instanceof Error ? err.message : String(err));
    articleUrl = null;
  }

  logger.debug("ArticleScreen", `Computed articleUrl: ${articleUrl ?? "(null)"}`);

  // Start reading session (guard with ref to prevent double-fire in StrictMode)
  useEffect(() => {
    if (!articleId || hasStartedRef.current) return;
    hasStartedRef.current = true;

    logger.info("ArticleScreen", `Starting reading session for ${articleId}`);

    // Mark as in_progress — wrapped in try-catch to prevent crash
    try {
      updateStatus.mutate(
        { articleId, status: "in_progress" },
        {
          onError: (err) => {
            logger.error("ArticleScreen", "Failed to update reading status", err instanceof Error ? err.message : String(err));
          },
        }
      );
    } catch (err) {
      logger.error("ArticleScreen", "Synchronous error calling updateStatus.mutate", err instanceof Error ? err.message : String(err));
    }

    // Start session — fully wrapped, non-critical
    startSession
      .mutateAsync(articleId)
      .then((id) => {
        if (id !== undefined && id !== null) {
          sessionIdRef.current = id;
          logger.info("ArticleScreen", `Session started with id ${id}`);
        }
      })
      .catch((err) => {
        logger.warn("ArticleScreen", "Failed to start reading session (non-critical)", err instanceof Error ? err.message : String(err));
      });

    return () => {
      if (sessionIdRef.current !== null) {
        try {
          endSession.mutate(sessionIdRef.current);
        } catch (err) {
          logger.warn("ArticleScreen", "Failed to end reading session on unmount", err instanceof Error ? err.message : String(err));
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleId]);

  const handleMarkAsRead = () => {
    if (!articleId || isMarkedRead) return;
    try {
      updateStatus.mutate(
        { articleId, status: "read" },
        {
          onError: (err) => {
            logger.error("ArticleScreen", "Failed to mark as read", err instanceof Error ? err.message : String(err));
          },
        }
      );
      setIsMarkedRead(true);
    } catch (err) {
      logger.error("ArticleScreen", "Synchronous error marking as read", err instanceof Error ? err.message : String(err));
    }
  };

  // Injected JS to detect scroll to bottom in the WebView
  const injectedJs = `
    (function() {
      var reported = false;
      window.addEventListener('scroll', function() {
        var scrollHeight = document.documentElement.scrollHeight;
        var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        var clientHeight = window.innerHeight;
        if (!reported && (scrollTop + clientHeight >= scrollHeight - 200)) {
          reported = true;
          window.ReactNativeWebView.postMessage('REACHED_BOTTOM');
        }
      });
    })();
    true;
  `;

  const handleMessage = (event: { nativeEvent: { data: string } }) => {
    if (event.nativeEvent.data === "REACHED_BOTTOM") {
      setHasReachedBottom(true);
    }
  };

  const handleLoadError = () => {
    logger.warn("ArticleScreen", `WebView load error for URL: ${articleUrl}`);
    setLoadError(true);
  };

  // Guard: if articleId is missing, show error
  if (!articleId) {
    logger.error("ArticleScreen", "No articleId in params");
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.errorContainer}>
          <Text style={[styles.errorTitle, { color: colors.text }]}>Missing article ID</Text>
          <Text style={[styles.errorDesc, { color: colors.textSecondary }]}>
            Could not determine which article to display.
          </Text>
          <Pressable
            style={[styles.waybackButton, { backgroundColor: colors.primary }]}
            onPress={() => router.back()}
          >
            <Text style={styles.waybackButtonText}>Go Back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Build the WebView URL
  const displayUrl = waybackUrl ?? (loadError ? null : articleUrl);

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "",
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
        }}
      />

      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {loadError && article?.contentHtml ? (
          // Offline fallback with cached content
          <View style={{ flex: 1 }}>
            <View style={[styles.deadLinkBanner, { backgroundColor: colors.warning }]}>
              <Text style={styles.deadLinkText}>
                Original link unavailable. Showing cached version.
              </Text>
              {articleUrl && (
                <Pressable onPress={() => setLoadError(false)}>
                  <Text style={[styles.retryLink, { color: colors.primary }]}>Try again</Text>
                </Pressable>
              )}
            </View>
            <WebView
              source={{ html: wrapHtml(article.contentHtml, colorScheme === "dark") }}
              style={{ flex: 1 }}
              injectedJavaScript={injectedJs}
              onMessage={handleMessage}
            />
          </View>
        ) : loadError ? (
          // Dead link, no cached content
          <View style={styles.errorContainer}>
            <Text style={[styles.errorTitle, { color: colors.text }]}>Link unavailable</Text>
            <Text style={[styles.errorDesc, { color: colors.textSecondary }]}>
              The original article could not be loaded and no cached version is available.
            </Text>
            {articleUrl && (
              <Pressable
                style={[styles.waybackButton, { backgroundColor: colors.primary }]}
                onPress={() => {
                  setLoadError(false);
                  setWaybackUrl(`https://web.archive.org/web/*/${articleUrl}`);
                }}
              >
                <Text style={styles.waybackButtonText}>Try Wayback Machine</Text>
              </Pressable>
            )}
          </View>
        ) : displayUrl ? (
          // Default: load original URL
          <WebView
            source={{ uri: displayUrl }}
            style={{ flex: 1 }}
            injectedJavaScript={injectedJs}
            onMessage={handleMessage}
            onError={handleLoadError}
            onHttpError={(syntheticEvent) => {
              const { statusCode } = syntheticEvent.nativeEvent;
              if (statusCode >= 400) handleLoadError();
            }}
          />
        ) : (
          // No valid URL available — show cached content if available
          article?.contentHtml ? (
            <WebView
              source={{ html: wrapHtml(article.contentHtml, colorScheme === "dark") }}
              style={{ flex: 1 }}
              injectedJavaScript={injectedJs}
              onMessage={handleMessage}
            />
          ) : (
            <View style={styles.errorContainer}>
              <Text style={[styles.errorTitle, { color: colors.text }]}>No content available</Text>
              <Text style={[styles.errorDesc, { color: colors.textSecondary }]}>
                This article does not have a valid URL or cached content.
              </Text>
              <Pressable
                style={[styles.waybackButton, { backgroundColor: colors.primary }]}
                onPress={() => router.back()}
              >
                <Text style={styles.waybackButtonText}>Go Back</Text>
              </Pressable>
            </View>
          )
        )}

        {/* Bottom toolbar */}
        <View style={[styles.toolbar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
          <Pressable style={styles.toolbarButton} onPress={() => router.back()}>
            <Text style={[styles.toolbarText, { color: colors.textSecondary }]}>Back</Text>
          </Pressable>

          {hasReachedBottom && !isMarkedRead && (
            <Pressable
              style={[styles.markReadButton, { backgroundColor: colors.accent }]}
              onPress={handleMarkAsRead}
            >
              <Text style={styles.markReadText}>Mark as Read</Text>
            </Pressable>
          )}

          {isMarkedRead && (
            <View style={[styles.markReadButton, { backgroundColor: colors.read }]}>
              <Text style={styles.markReadText}>Read</Text>
            </View>
          )}

          <Pressable
            style={styles.toolbarButton}
            onPress={handleMarkAsRead}
          >
            <Text style={[styles.toolbarText, { color: isMarkedRead ? colors.read : colors.textSecondary }]}>
              {isMarkedRead ? "\u2713" : "\u25CB"}
            </Text>
          </Pressable>
        </View>
      </View>
    </>
  );
}

// Wrap with ErrorBoundary so crashes show a fallback instead of killing the app
export default function ArticleScreen() {
  const router = useRouter();
  return (
    <ErrorBoundary
      fallbackTitle="Article could not be loaded"
      onReset={() => router.back()}
    >
      <ArticleScreenInner />
    </ErrorBoundary>
  );
}

function wrapHtml(html: string, darkMode: boolean): string {
  const bg = darkMode ? "#0f172a" : "#ffffff";
  const fg = darkMode ? "#f1f5f9" : "#1a1a2e";
  const linkColor = darkMode ? "#818cf8" : "#4f46e5";

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body {
          font-family: -apple-system, system-ui, sans-serif;
          font-size: 17px;
          line-height: 1.6;
          color: ${fg};
          background: ${bg};
          padding: 16px;
          max-width: 100%;
          word-wrap: break-word;
          overflow-wrap: break-word;
        }
        img { max-width: 100%; height: auto; }
        a { color: ${linkColor}; }
        pre, code {
          background: ${darkMode ? "#1e293b" : "#f3f4f6"};
          border-radius: 4px;
          padding: 2px 6px;
          font-size: 14px;
          overflow-x: auto;
        }
        pre { padding: 12px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid ${darkMode ? "#334155" : "#e5e7eb"}; padding: 8px; }
        blockquote {
          border-left: 3px solid ${linkColor};
          margin-left: 0;
          padding-left: 16px;
          opacity: 0.85;
        }
      </style>
    </head>
    <body>${html}</body>
    </html>
  `;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderTopWidth: 1,
  },
  toolbarButton: { padding: Spacing.sm },
  toolbarText: { fontSize: FontSize.lg },
  markReadButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: 20,
  },
  markReadText: { color: "#fff", fontWeight: "600", fontSize: FontSize.sm },
  deadLinkBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: Spacing.sm,
  },
  deadLinkText: { color: "#fff", fontSize: FontSize.sm, flex: 1 },
  retryLink: { fontWeight: "600", fontSize: FontSize.sm, marginLeft: Spacing.sm },
  errorContainer: { flex: 1, justifyContent: "center", alignItems: "center", padding: Spacing.xl },
  errorTitle: { fontSize: FontSize.xl, fontWeight: "600", marginBottom: Spacing.sm },
  errorDesc: { fontSize: FontSize.md, textAlign: "center", marginBottom: Spacing.lg, lineHeight: 24 },
  waybackButton: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, borderRadius: 8 },
  waybackButtonText: { color: "#fff", fontWeight: "600" },
});
