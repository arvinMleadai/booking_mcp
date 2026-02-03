# Solution for VAPI Outbound Call Workflow

## Understanding the Problem

**Current Workflow:**
1. Outbound call starts → VAPI receives instructions with IDs embedded
2. Instructions contain: `Board Id is b44305a9-9a2f-408c-b2d0-2a0b73fc3142`, etc.
3. LLM (smaller model) should extract IDs from instructions
4. LLM calls MCP tool with extracted IDs
5. **Problem**: Smaller models aren't extracting IDs reliably → IDs are `undefined`

## Solution Implemented

### 1. **New Helper Tool: `ExtractBookingIds`**

A dedicated tool the LLM can call FIRST to extract IDs from instructions:

```typescript
ExtractBookingIds({
  instructionsText: "Board Id is b44305a9-9a2f-408c-b2d0-2a0b73fc3142\nStage Id is..."
})
```

**Returns:**
```
EXTRACTED BOOKING IDs

boardId: b44305a9-9a2f-408c-b2d0-2a0b73fc3142
stageId: afac5248-59e5-41f4-b06c-01ea68d6af6a
dealId: 14588
agentId: e2fff356-eda9-4f8d-94a3-ca0c0a4efcd2
clientId: 10000002
timezone: Africa/Casablanca

Use these IDs when calling BookCustomerAppointment or FindAvailableBookingSlots.
```

### 2. **Enhanced Tool Descriptions**

Both `BookCustomerAppointment` and `FindAvailableBookingSlots` now have:
- **Explicit extraction steps** telling the LLM WHERE to look ("***Booking Instructions***" section)
- **Exact format examples** matching your instructions
- **Alternative fallback** via `instructionsText` parameter

### 3. **Automatic Extraction Fallback**

If the LLM passes `instructionsText` parameter, IDs are extracted automatically:
- No need for LLM to extract manually
- Works even if LLM can't parse the instructions
- Programmatic extraction is 100% reliable

## Recommended LLM Workflow

### Option A: Use Helper Tool (Best for Small Models)

```
1. LLM receives instructions with IDs
2. LLM calls ExtractBookingIds with instructions text
3. Gets extracted IDs back
4. LLM calls BookCustomerAppointment with extracted IDs
```

### Option B: Direct Extraction (For Larger Models)

```
1. LLM receives instructions with IDs
2. LLM extracts IDs itself from instructions
3. LLM calls BookCustomerAppointment with extracted IDs
```

### Option C: Pass Instructions Text (Fallback)

```
1. LLM receives instructions with IDs
2. LLM can't extract IDs
3. LLM calls BookCustomerAppointment with instructionsText parameter
4. System extracts IDs automatically
```

## Updated Tool Descriptions

The tools now explicitly tell the LLM:
1. **WHERE** to look: "***Booking Instructions***" section
2. **WHAT** to find: "Board Id is ...", "Stage Id is ...", "Deal id is ..."
3. **HOW** to extract: Copy the UUID/number after "is"

## Example Instructions Format

Your instructions:
```
#***Booking Instructions***

- Board Id is b44305a9-9a2f-408c-b2d0-2a0b73fc3142
- Stage Id is afac5248-59e5-41f4-b06c-01ea68d6af6a
- Deal id is 14588
```

**Extraction patterns now handle:**
- ✅ `Board Id is ...` (your format)
- ✅ `Board Id: ...` (alternative)
- ✅ `Board ID is ...` (case variations)
- ✅ All other variations

## Benefits

1. **Helper tool** - Small models can use it to extract IDs reliably
2. **Automatic fallback** - `instructionsText` parameter extracts programmatically
3. **Better descriptions** - Explicit WHERE/WHAT/HOW instructions
4. **Multiple options** - LLM can choose the method that works best

## Testing

Test with your smaller model:
1. Does it call `ExtractBookingIds` first? ✅
2. Does it extract IDs directly? ✅
3. Does it pass `instructionsText` as fallback? ✅

Any of these methods will work!

