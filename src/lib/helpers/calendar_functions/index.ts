// Unified Calendar Service (recommended for all new code)
export { CalendarService } from "./calendar-service";
export * from "./providers";

// Core utilities
export * from "./getClientTimeZone";
export * from "./graphHelper";
export * from "./graphDatabase";
export * from "./optimizedConflictDetection";

// Legacy exports (deprecated - use CalendarService instead)
// These are kept for backward compatibility but will be removed in future versions
export * from "./finalOptimizedCalendarOperations";
export * from "./enhancedGraphApiService";
export * from "./enhancedErrorHandler";
export * from "./adaptiveRateLimiter";