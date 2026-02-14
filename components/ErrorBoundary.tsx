import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { logger } from "../services/logger";
import { Colors, Spacing, FontSize } from "../constants/theme";

type Props = {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
};

type State = {
  hasError: boolean;
  error: Error | null;
};

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error(
      "ErrorBoundary",
      `Caught error: ${error.message}`,
      {
        stack: error.stack?.substring(0, 1000),
        componentStack: errorInfo.componentStack?.substring(0, 1000),
      }
    );
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      const colors = Colors.light; // Safe default
      return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
          <Text style={[styles.title, { color: colors.error }]}>
            {this.props.fallbackTitle ?? "Something went wrong"}
          </Text>
          <Text style={[styles.message, { color: colors.textSecondary }]}>
            {this.state.error?.message ?? "An unexpected error occurred."}
          </Text>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>
            This error has been logged for debugging. Check Settings → Debug Log for details.
          </Text>
          <Pressable
            style={[styles.button, { backgroundColor: colors.primary }]}
            onPress={this.handleReset}
          >
            <Text style={styles.buttonText}>Try Again</Text>
          </Pressable>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.xl,
  },
  title: {
    fontSize: FontSize.xl,
    fontWeight: "600",
    marginBottom: Spacing.sm,
  },
  message: {
    fontSize: FontSize.md,
    textAlign: "center",
    marginBottom: Spacing.sm,
    lineHeight: 22,
  },
  hint: {
    fontSize: FontSize.sm,
    textAlign: "center",
    marginBottom: Spacing.lg,
    fontStyle: "italic",
  },
  button: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: 8,
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: FontSize.md,
  },
});
