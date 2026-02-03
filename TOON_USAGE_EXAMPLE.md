# TOON Format Usage Example

## How TOON Helps with Extraction

TOON (Token-Oriented Object Notation) provides a **schema-aware, compact format** that makes data extraction more reliable for smaller LLM models. Here's how it works:

## Before (Free-form Text)

```
Booking Instructions:
- Board Id: b44305a9-9a2f-408c-b2d0-2a0b73fc3142
- Stage Id: afac5248-59e5-41f4-b06c-01ea68d6af6a
- Deal id: 14588
- Agent ID: e2fff356-eda9-4f8d-94a3-ca0c0a4efcd2
- Client ID: 10000002
- Timezone: Africa/Casablanca
```

**Problem**: Smaller models might miss these values scattered in text.

## After (TOON Format)

```toon
bookingConfig{boardId,stageId,dealId,agentId,clientId,timezone}:
  b44305a9-9a2f-408c-b2d0-2a0b73fc3142,afac5248-59e5-41f4-b06c-01ea68d6af6a,14588,e2fff356-eda9-4f8d-94a3-ca0c0a4efcd2,10000002,Africa/Casablanca
```

**Benefits**:
1. **Explicit Schema**: The header `bookingConfig{boardId,stageId,dealId,...}` tells the model exactly what fields exist
2. **Compact**: ~70% fewer tokens than JSON
3. **Structured**: Values are in a predictable order
4. **Self-documenting**: The structure itself explains the data

## Implementation Options

### Option 1: Pre-process Instructions (Recommended)

When loading agent instructions, automatically convert to TOON:

```typescript
import { extractAndFormatAsToon } from '@/lib/helpers/toon-instructions';

// When loading instructions
const instructions = await getAgentInstructions(agentId);
const { config, toonFormat } = extractAndFormatAsToon(instructions);

// Include both formats in context
const context = `
${instructions}

Booking Configuration (TOON):
\`\`\`toon
${toonFormat}
\`\`\`
`;
```

### Option 2: Store Instructions in TOON

Store booking instructions directly in TOON format in your database:

```sql
-- Store TOON format in agent instructions
UPDATE agents 
SET user_instruction = '{
  "bookingConfig": {
    "boardId": "b44305a9-9a2f-408c-b2d0-2a0b73fc3142",
    "stageId": "afac5248-59e5-41f4-b06c-01ea68d6af6a",
    "dealId": 14588
  },
  "toonFormat": "bookingConfig{boardId,stageId,dealId}:\n  b44305a9-9a2f-408c-b2d0-2a0b73fc3142,afac5248-59e5-41f4-b06c-01ea68d6af6a,14588"
}'
WHERE uuid = 'e2fff356-eda9-4f8d-94a3-ca0c0a4efcd2';
```

### Option 3: Include TOON in Tool Descriptions

The tool descriptions now include TOON examples, so models learn the format.

## Testing

Test extraction accuracy:

```typescript
import { extractBookingIds } from '@/lib/helpers/toon-instructions';

const instructions = `
Board Id: b44305a9-9a2f-408c-b2d0-2a0b73fc3142
Stage Id: afac5248-59e5-41f4-b06c-01ea68d6af6a
Deal id: 14588
`;

const config = extractBookingIds(instructions);
console.log(config);
// {
//   boardId: 'b44305a9-9a2f-408c-b2d0-2a0b73fc3142',
//   stageId: 'afac5248-59e5-41f4-b06c-01ea68d6af6a',
//   dealId: 14588
// }
```

## Why This Works Better

1. **Schema Header**: `bookingConfig{boardId,stageId,dealId}` explicitly lists all fields
2. **Positional Values**: Values are in the same order as the schema
3. **No Ambiguity**: Clear structure reduces parsing errors
4. **Token Efficient**: More context fits in the same token budget
5. **Model Training**: Many models have seen TOON in training data

## Next Steps

1. Install TOON library: `npm install @toon-format/toon`
2. Use the utility functions in `src/lib/helpers/toon-instructions.ts`
3. Convert instructions to TOON when loading agent context
4. Monitor extraction accuracy improvements

