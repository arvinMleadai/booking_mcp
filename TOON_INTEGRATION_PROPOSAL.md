# TOON Format Integration for Better ID Extraction

## How TOON Can Help

[TOON (Token-Oriented Object Notation)](https://github.com/toon-format/toon) is a compact, schema-aware format designed specifically for LLM prompts. It can improve extraction accuracy by:

1. **Explicit Structure**: Makes data relationships clear and easier to parse
2. **Token Efficiency**: Reduces tokens, allowing more context to fit
3. **Schema-Aware**: Models can understand the structure better
4. **Human-Readable**: Still readable while being more structured than JSON

## Integration Strategy

### Option 1: Format Booking Instructions in TOON

Instead of free-form text instructions, format them in TOON:

**Current Format:**
```
Board Id: b44305a9-9a2f-408c-b2d0-2a0b73fc3142
Stage Id: afac5248-59e5-41f4-b06c-01ea68d6af6a
Deal id: 14588
```

**TOON Format:**
```toon
bookingConfig{boardId,stageId,dealId,agentId,clientId,timezone}:
  b44305a9-9a2f-408c-b2d0-2a0b73fc3142,afac5248-59e5-41f4-b06c-01ea68d6af6a,14588,e2fff356-eda9-4f8d-94a3-ca0c0a4efcd2,10000002,Africa/Casablanca
```

### Option 2: Include TOON Examples in Tool Descriptions

Add TOON-formatted examples directly in the tool descriptions to show models the expected structure.

### Option 3: Pre-process Instructions to TOON

When instructions are loaded, convert them to TOON format automatically.

## Implementation Plan

### Step 1: Install TOON Library

```bash
npm install @toon-format/toon
```

### Step 2: Create Instruction Parser

Create a utility that extracts booking IDs and formats them in TOON.

### Step 3: Update Tool Descriptions

Include TOON examples in the tool descriptions.

### Step 4: Add TOON Response Format (Optional)

Format responses in TOON for easier parsing by models.

## Benefits

1. **Better Extraction**: Explicit structure helps smaller models extract values
2. **Token Savings**: TOON is ~50-70% more token-efficient than JSON
3. **Clearer Context**: Schema header makes relationships obvious
4. **Consistent Format**: Standardized structure across all instructions

## Example Implementation

See `src/lib/helpers/toon-instructions.ts` for the implementation.

