# MCP Tool Optimization for Smaller LLM Models

## Problem
Smaller LLM models (like GPT-4o-mini) were not extracting `boardId`, `stageId`, and `dealId` from booking instructions, even though these values were present in the context. This caused booking failures when agents had no calendar assignment, as the system couldn't fall back to pipeline-level calendars.

## Solution
Optimized the MCP tool descriptions to be more explicit and directive for smaller models.

## Changes Made

### 1. Enhanced Tool Descriptions

**Before:**
```
"CRITICAL: Extract and pass boardId, stageId, and dealId if they appear ANYWHERE..."
```

**After:**
```
"REQUIRED: Before calling this tool, scan ALL booking instructions, agent instructions, and context for these IDs and ALWAYS include them: boardId (look for 'Board Id:', 'Board ID:', 'boardId'), stageId (look for 'Stage Id:', 'Stage ID:', 'stageId'), dealId (look for 'Deal id:', 'Deal ID:', 'dealId'). These are usually in the booking instructions section."
```

### 2. More Explicit Field Descriptions

Each field now includes:
- **"REQUIRED IF IN INSTRUCTIONS"** prefix to emphasize importance
- **"MUST extract"** directive language
- **Multiple pattern examples** (e.g., 'Board Id:', 'Board ID:', 'boardId')
- **Concrete examples** from actual instructions (e.g., 'Board Id: b44305a9-9a2f-408c-b2d0-2a0b73fc3142')
- **"SCAN ALL INSTRUCTIONS BEFORE CALLING"** reminder

**Example:**
```typescript
boardId: z
  .string()
  .uuid()
  .optional()
  .describe(
    "REQUIRED IF IN INSTRUCTIONS: Pipeline/board UUID. MUST extract from booking instructions if present. Look for: 'Board Id:', 'Board ID:', 'boardId', 'Board Id: b44305a9-9a2f-408c-b2d0-2a0b73fc3142'. Format: UUID string. Example: 'b44305a9-9a2f-408c-b2d0-2a0b73fc3142'. Uses pipeline's calendar when agent has no calendar. SCAN ALL INSTRUCTIONS BEFORE CALLING."
  )
```

### 3. Added Debugging Warnings

Added console warnings when IDs are missing to help identify extraction issues:
```typescript
if (!args.boardId || !args.stageId || !args.dealId) {
  console.warn("⚠️ Missing IDs - Check if these are in booking instructions:");
  if (!args.boardId) console.warn("  - boardId not provided (look for 'Board Id:' in instructions)");
  if (!args.stageId) console.warn("  - stageId not provided (look for 'Stage Id:' in instructions)");
  if (!args.dealId) console.warn("  - dealId not provided (look for 'Deal id:' in instructions)");
}
```

## Tools Updated

1. **BookCustomerAppointment** - Main booking tool
2. **FindAvailableBookingSlots** - Slot finding tool

Both tools now have:
- Enhanced main descriptions
- Explicit field descriptions for `boardId`, `stageId`, and `dealId`
- Debugging warnings

## Why This Works Better for Smaller Models

1. **Explicit Instructions**: Smaller models need more direct, step-by-step instructions
2. **Multiple Patterns**: Providing multiple pattern variations helps models recognize IDs in different formats
3. **Concrete Examples**: Real examples from instructions help models understand the expected format
4. **Repetition**: Repeating the instruction in both the tool description and field descriptions reinforces the requirement
5. **Action Words**: Using "MUST", "REQUIRED", "ALWAYS" creates stronger directives
6. **Context Hints**: Telling models where to look ("booking instructions section") provides guidance

## Expected Behavior

After these changes, smaller models should:
1. Scan instructions more thoroughly before calling tools
2. Extract IDs even when they appear in different formats
3. Include IDs more consistently in tool calls
4. Provide better fallback to pipeline calendars when agent has no calendar

## Testing Recommendations

1. Test with smaller models (GPT-4o-mini, GPT-3.5-turbo)
2. Verify IDs are extracted from various instruction formats:
   - `Board Id: b44305a9-9a2f-408c-b2d0-2a0b73fc3142`
   - `Board ID: b44305a9-9a2f-408c-b2d0-2a0b73fc3142`
   - `boardId: b44305a9-9a2f-408c-b2d0-2a0b73fc3142`
3. Check logs for warning messages when IDs are missing
4. Verify pipeline calendar fallback works when agent has no calendar

## Additional Optimization Ideas (Future)

1. **Pre-processing Hook**: Add a function that extracts IDs from common patterns before the tool is called
2. **Default Values**: If IDs are consistently the same for an agent, store them in agent configuration
3. **Validation Layer**: Add a validation step that checks for missing IDs and suggests values from instructions
4. **Context Injection**: If the MCP handler has access to full context, inject a summary of available IDs before tool descriptions

