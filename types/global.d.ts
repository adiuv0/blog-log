/**
 * React Native global ErrorUtils (available on the global scope in RN runtime).
 * Not part of the standard TypeScript types.
 */
declare const ErrorUtils: {
  getGlobalHandler(): (error: Error, isFatal?: boolean) => void;
  setGlobalHandler(handler: (error: Error, isFatal?: boolean) => void): void;
};
