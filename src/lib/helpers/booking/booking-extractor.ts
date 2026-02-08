/**
 * Booking ID Extraction
 * Simplified regex-based extraction for structured VAPI payloads
 */

import type { BookingIds } from './booking-types';

/**
 * Extract booking IDs from instruction text using regex patterns
 * Optimized for VAPI payload format
 * 
 * @param instructionsText - Structured text containing booking IDs
 * @returns Extracted booking IDs
 * 
 * @example
 * const ids = extractBookingIds(`
 *   Agent ID is e2fff356-eda9-4f8d-94a3-ca0c0a4efcd2
 *   Client ID is 10000002
 *   Board Id is b44305a9-9a2f-408c-b2d0-2a0b73fc3142
 *   Stage Id is afac5248-59e5-41f4-b06c-01ea68d6af6a
 *   Deal id is 14588
 *   Timezone is Africa/Casablanca
 * `);
 */
export function extractBookingIds(instructionsText: string): BookingIds {
  if (!instructionsText || instructionsText.trim().length === 0) {
    return {};
  }
  console.log('1. Instructions Text:', instructionsText);
  const config: BookingIds = {};

  // 0. Try to parse as JSON first (LLM sometimes sends JSON string)
  // Robust parsing: find the substring from first '{' to last '}'
  const jsonMatch = instructionsText.match(/(\{[\s\S]*\})/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      console.log('2. Instructions Text:', instructionsText);
      console.debug('✅ [extractBookingIds] Parsed JSON input:', parsed);
      
      // Map parsed fields to config
      if (parsed.agentId) config.agentId = parsed.agentId;
      if (parsed.clientId) config.clientId = typeof parsed.clientId === 'string' ? parseInt(parsed.clientId) : parsed.clientId;
      if (parsed.boardId) config.boardId = parsed.boardId;
      if (parsed.stageId) config.stageId = parsed.stageId;
      if (parsed.dealId) config.dealId = typeof parsed.dealId === 'string' ? parseInt(parsed.dealId) : parsed.dealId;
      if (parsed.timezone) config.timezone = parsed.timezone;

      return config;
    } catch (e) {
      console.warn('⚠️ [extractBookingIds] JSON parse failed, falling back to regex:', e);
      // Continue to regex extraction below
    }
  }

  // 1. Fallback: Regex-based extraction for weaker models
  // Pattern: "Agent ID is <uuid>"
  const agentIdMatch = instructionsText.match(/Agent\s+ID\s+is\s+([a-f0-9-]{36})/i);
  if (agentIdMatch) config.agentId = agentIdMatch[1];

  // Pattern: "Client ID is <number>"
  const clientIdMatch = instructionsText.match(/Client\s+ID\s+is\s+(\d+)/i);
  if (clientIdMatch) config.clientId = parseInt(clientIdMatch[1]);

  // Pattern: "Board Id is <uuid>"
  const boardIdMatch = instructionsText.match(/Board\s+Id\s+is\s+([a-f0-9-]{36})/i);
  if (boardIdMatch) config.boardId = boardIdMatch[1];

  // Pattern: "Stage Id is <uuid>"
  const stageIdMatch = instructionsText.match(/Stage\s+Id\s+is\s+([a-f0-9-]{36})/i);
  if (stageIdMatch) config.stageId = stageIdMatch[1];

  // Pattern: "Deal id is <number>"
  const dealIdMatch = instructionsText.match(/Deal\s+id\s+is\s+(\d+)/i);
  if (dealIdMatch) config.dealId = parseInt(dealIdMatch[1]);

  // Pattern: "Timezone is <timezone>"
  const timezoneMatch = instructionsText.match(/Timezone\s+is\s+([\w\/]+)/i);
  if (timezoneMatch) config.timezone = timezoneMatch[1];

  return config;
}

/**
 * Validate that required booking IDs are present
 * 
 * For INBOUND calls: Only clientId and agentId are required
 * For OUTBOUND calls: All IDs (boardId, stageId, dealId) are typically present but not strictly required
 * 
 * @param ids - Extracted booking IDs
 * @returns Validation result with missing IDs if any
 */
export function validateRequiredIds(
  ids: BookingIds
): { valid: boolean; missing: string[] } {
  // Only clientId and agentId are ESSENTIAL for booking
  // boardId, stageId, dealId are optional (only available for outbound calls)
  const required = ['clientId', 'agentId'] as const;
  const missing: string[] = [];

  for (const field of required) {
    if (!ids[field]) {
      missing.push(field);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}

/**
 * Helper to format extracted IDs for logging/debugging
 * @param ids - The booking IDs that were extracted
 * @returns Formatted string for logging
 */
export function formatExtractedIds(ids: BookingIds): string {
  return JSON.stringify(ids, null, 2);
}

/**
 * Infer missing boardId and stageId from dealId by querying the database
 * This is useful when weaker AI models don't provide all IDs
 * 
 * @param ids - Current booking IDs
 * @param clientId - Client ID for database queries
 * @returns Updated booking IDs with inferred values
 */
export async function inferMissingIds(
  ids: BookingIds,
  clientId: number
): Promise<BookingIds> {
  const { getStageItemById, getPipelineStageById } = await import('../booking_functions/bookingMetadata');
  
  // If we have dealId but missing boardId or stageId, try to infer them
  if (ids.dealId && (!ids.boardId || !ids.stageId)) {
    try {
      console.log(`🔍 [inferMissingIds] Attempting to infer missing IDs from dealId: ${ids.dealId}`);
      
      // Step 1: Get the deal to find pipeline_stage_id
      const deal = await getStageItemById(ids.dealId);
      if (!deal) {
        console.warn(`⚠️ [inferMissingIds] Deal ${ids.dealId} not found`);
        return ids;
      }
      
      // Step 2: Infer stageId if missing
      if (!ids.stageId && deal.pipeline_stage_id) {
        ids.stageId = deal.pipeline_stage_id;
        console.log(`✅ [inferMissingIds] Inferred stageId: ${ids.stageId}`);
      }
      
      // Step 3: Get the stage to find pipeline_id (boardId)
      if (!ids.boardId && deal.pipeline_stage_id) {
        const stage = await getPipelineStageById(deal.pipeline_stage_id);
        if (stage?.pipeline_id) {
          ids.boardId = stage.pipeline_id;
          console.log(`✅ [inferMissingIds] Inferred boardId: ${ids.boardId}`);
        } else {
          console.warn(`⚠️ [inferMissingIds] Could not find pipeline for stage ${deal.pipeline_stage_id}`);
        }
      }
    } catch (error) {
      console.error(`❌ [inferMissingIds] Error inferring IDs:`, error);
    }
  }
  
  return ids;
}

/**
 * Format instruction text for consistent extraction
 * Useful for testing and debugging
 * 
 * @param ids - Booking IDs to format
 * @returns Formatted instruction text
 */
export function formatInstructionsText(ids: Required<BookingIds>): string {
  console.log('3. Instructions Text:', ids);
  return `Agent ID is ${ids.agentId}
Client ID is ${ids.clientId}
Board Id is ${ids.boardId}
Stage Id is ${ids.stageId}
Deal id is ${ids.dealId}
Timezone is ${ids.timezone}`;
}

/**
 * Parse and validate UUID format
 * 
 * @param value - String to validate
 * @returns True if valid UUID format
 */
export function isValidUUID(value: string | undefined): boolean {
  if (!value) return false;
  const uuidRegex = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  return uuidRegex.test(value);
}

/**
 * Validate numeric ID
 * 
 * @param value - Value to validate
 * @returns True if valid positive integer
 */
export function isValidNumericId(value: number | undefined): boolean {
  if (value === undefined || value === null) return false;
  return Number.isInteger(value) && value > 0;
}
