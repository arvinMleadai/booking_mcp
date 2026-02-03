# Final Solution: Programmatic ID Extraction from Instructions

## Problem
- IDs (`boardId`, `stageId`, `dealId`) are **NOT stored in the database**
- They're only passed in the **prompt/context during outbound calls**
- Smaller LLM models aren't extracting them reliably
- We can't extract from database (they don't exist there)

## Solution
Added an **optional `instructionsText` parameter** to both booking tools. The LLM can pass the instructions text, and we extract IDs programmatically.

## How It Works

### Option 1: LLM Extracts IDs (Ideal)
The LLM reads the instructions and extracts IDs itself, passing them directly:
```json
{
  "boardId": "b44305a9-9a2f-408c-b2d0-2a0b73fc3142",
  "stageId": "afac5248-59e5-41f4-b06c-01ea68d6af6a",
  "dealId": 14588
}
```

### Option 2: LLM Passes Instructions Text (Fallback)
If the LLM can't extract IDs, it can pass the instructions text:
```json
{
  "instructionsText": "Board Id is b44305a9-9a2f-408c-b2d0-2a0b73fc3142\nStage Id is afac5248-59e5-41f4-b06c-01ea68d6af6a\nDeal id is 14588"
}
```

The system will automatically extract IDs from the text using regex patterns.

## Updated Tool Parameters

Both `BookCustomerAppointment` and `FindAvailableBookingSlots` now have:

```typescript
instructionsText: z
  .string()
  .optional()
  .describe(
    "OPTIONAL: If boardId/stageId/dealId are missing, pass the booking instructions text here and they will be extracted automatically. Look for lines like 'Board Id is b44305a9-9a2f-408c-b2d0-2a0b73fc3142' or 'Stage Id is afac5248-59e5-41f4-b06c-01ea68d6af6a'."
  )
```

## Extraction Patterns

The extraction function now handles your exact format:
- ✅ `Board Id is b44305a9-9a2f-408c-b2d0-2a0b73fc3142`
- ✅ `Stage Id is afac5248-59e5-41f4-b06c-01ea68d6af6a`
- ✅ `Deal id is 14588`

Also handles alternative formats:
- `Board Id: ...`
- `Board ID is ...`
- `boardId: ...`
- etc.

## Benefits

1. **No database dependency** - Works with runtime instructions
2. **Automatic fallback** - If LLM can't extract, pass instructions text
3. **Multiple format support** - Handles various instruction formats
4. **Backward compatible** - Existing calls still work

## Usage for LLM

The LLM should:
1. **First try**: Extract IDs from instructions and pass them directly
2. **If that fails**: Pass the `instructionsText` parameter with the full instructions
3. System will extract IDs automatically

## Example

**Your instructions:**
```
Board Id is b44305a9-9a2f-408c-b2d0-2a0b73fc3142
Stage Id is afac5248-59e5-41f4-b06c-01ea68d6af6a
Deal id is 14588
```

**LLM can call:**
```json
{
  "instructionsText": "Board Id is b44305a9-9a2f-408c-b2d0-2a0b73fc3142\nStage Id is afac5248-59e5-41f4-b06c-01ea68d6af6a\nDeal id is 14588"
}
```

**System extracts:**
- `boardId`: `b44305a9-9a2f-408c-b2d0-2a0b73fc3142`
- `stageId`: `afac5248-59e5-41f4-b06c-01ea68d6af6a`
- `dealId`: `14588`

## What Changed

1. ✅ Removed database extraction (IDs aren't in database)
2. ✅ Added `instructionsText` parameter to both tools
3. ✅ Added programmatic extraction from instructions text
4. ✅ Updated extraction patterns to match your format ("Board Id is" not "Board Id:")
5. ✅ Enhanced tool descriptions with TOON examples

## Next Steps

1. Update your LLM prompt/system instructions to:
   - First try extracting IDs from instructions
   - If extraction fails, pass `instructionsText` parameter
2. Test with smaller models
3. Monitor extraction success rate

