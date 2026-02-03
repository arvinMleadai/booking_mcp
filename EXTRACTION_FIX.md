# Extraction Pattern Fix

## Problem
The booking instructions use the format:
- `Board Id is b44305a9-9a2f-408c-b2d0-2a0b73fc3142`
- `Stage Id is afac5248-59e5-41f4-b06c-01ea68d6af6a`
- `Deal id is 14588`

But the regex patterns only matched formats with colons like:
- `Board Id: b44305a9-9a2f-408c-b2d0-2a0b73fc3142`

## Solution
Updated all regex patterns in `src/lib/helpers/toon-instructions.ts` to handle both formats:

### Updated Patterns

**boardId:**
- ✅ `Board Id is ...` (NEW - matches your format)
- ✅ `Board Id: ...` (existing)
- ✅ `Board ID is ...` (NEW)
- ✅ `Board ID: ...` (existing)
- ✅ Other variations

**stageId:**
- ✅ `Stage Id is ...` (NEW - matches your format)
- ✅ `Stage Id: ...` (existing)
- ✅ `Stage ID is ...` (NEW)
- ✅ `Stage ID: ...` (existing)
- ✅ Other variations

**dealId:**
- ✅ `Deal id is ...` (NEW - matches your format)
- ✅ `Deal id: ...` (existing)
- ✅ `Deal ID is ...` (NEW)
- ✅ `Deal ID: ...` (existing)
- ✅ Other variations

**Also updated:**
- `agentId` patterns
- `clientId` patterns
- `timezone` patterns

## Test Your Format

Your instructions format:
```
Board Id is b44305a9-9a2f-408c-b2d0-2a0b73fc3142
Stage Id is afac5248-59e5-41f4-b06c-01ea68d6af6a
Deal id is 14588
```

Will now be extracted correctly! ✅

## How It Works

When the MCP handler receives a request with missing IDs:
1. Fetches agent's `user_instruction` from database
2. Uses updated regex patterns to extract IDs
3. Automatically fills in missing `boardId`, `stageId`, `dealId`
4. Logs extraction success

You should now see:
```
🔍 Attempting to extract missing IDs from agent instructions...
✅ Extracted boardId from instructions: b44305a9-9a2f-408c-b2d0-2a0b73fc3142
✅ Extracted stageId from instructions: afac5248-59e5-41f4-b06c-01ea68d6af6a
✅ Extracted dealId from instructions: 14588
```

