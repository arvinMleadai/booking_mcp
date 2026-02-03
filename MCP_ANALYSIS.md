# Booking MCP Handler - Comprehensive Analysis

## Overview
This MCP (Model Context Protocol) handler provides a booking system for customer appointments with agent calendar integration. It supports both Microsoft and Google calendars, with automatic customer lookup, calendar conflict detection, and pipeline/deal integration.

**Base Path:** `/api/booking`  
**HTTP Methods:** GET, POST, DELETE  
**Framework:** Next.js API Route with `mcp-handler`

---

## Registered Tools (Hooks)

### 1. **ListAgents**
**Purpose:** List all available agents for a client with their calendar connection status.

**Input Schema:**
- `clientId` (number | string): Client ID (e.g., 10000002)
- `includeDedicated` (boolean, optional, default: true): Include dedicated agents
- `withCalendarOnly` (boolean, optional, default: false): Filter to only agents with calendar connections

**Functionality:**
- Queries agents from database via `getAgentsForClient()`
- Returns agent summary with:
  - UUID, name, title, description
  - Agent type (Dedicated/Shared)
  - Calendar connection status
  - Calendar provider (Microsoft/Google) and email
  - Profile name and timezone

**Database Queries:**
- `getAgentsForClient(clientId, options)` - Fetches agents with calendar assignments

**Response Format:**
```
AVAILABLE AGENTS (Client: {clientId})

{count} agent(s) found:

1. {name}
   UUID: {uuid}
   Title: {title}
   Type: {Dedicated|Shared}
   Calendar: {Connected|Not Connected}
   Provider: {MICROSOFT|GOOGLE} ({email})
   Profile: {profileName}
   Timezone: {timezone}
```

---

### 2. **BookCustomerAppointment**
**Purpose:** Book a customer appointment with an agent. Automatically handles customer lookup, calendar validation, conflict detection, and meeting creation.

**Input Schema:**
- `clientId` (number | string): Client ID
- `agentId` (string, UUID): Agent UUID from ListAgents
- `boardId` (string, UUID, optional): Pipeline/board UUID - used for calendar selection
- `stageId` (string, UUID, optional): Pipeline stage UUID - used for subject generation
- `dealId` (number | string, optional): Deal ID - auto-fetches customer info from deal's party_id
- `customerName` (string, optional): Customer name (auto-fetched if dealId provided)
- `customerEmail` (string, optional): Customer email (auto-fetched if dealId provided)
- `customerPhoneNumber` (string, optional): Customer phone (auto-fetched if dealId provided)
- `subject` (string, optional): Meeting title (auto-generated from stage/deal if provided)
- `startDateTime` (string, required): ISO 8601 format (must be 15+ minutes in future)
- `endDateTime` (string, required): ISO 8601 format
- `description` (string, optional): Meeting description
- `location` (string, optional): Meeting location
- `isOnlineMeeting` (boolean, optional, default: true): Create Teams/Meet meeting
- `calendarId` (string, optional): Calendar connection ID override

**Functionality Flow:**

1. **Metadata Resolution (Auto-inference):**
   - If `dealId` provided → Fetch deal → Auto-infer `stageId` from `deal.pipeline_stage_id`
   - If `stageId` provided (or inferred) → Fetch stage → Auto-infer `boardId` from `stage.pipeline_id`
   - If `boardId` provided (or inferred) → Fetch pipeline → Get `pipeline.calendar_id` for fallback calendar

2. **Calendar Selection Priority:**
   - `request.calendarId` (explicit override)
   - `pipeline.calendar_id` (board-level calendar)
   - Agent's assigned calendar (fallback)

3. **Agent Validation:**
   - Validates agent exists and has calendar connection
   - Uses `validateAgentHasCalendar(agentId, clientId, calendarConnectionId)`

4. **Customer Lookup (Multi-source Priority):**
   - **Priority 1:** If `dealId` provided:
     - Fetch deal → Get `deal.party_id`
     - Lookup party → Get `party.contacts_id`
     - Fetch contact → Extract name, email, phone
   - **Priority 2:** Fuzzy search in `customers` table (if `customerName` provided)
   - **Priority 3:** Fuzzy search in `contacts` table (if not found in customers)
   - **Priority 4:** Use manually provided customer info

5. **Time Validation:**
   - Must be at least 15 minutes in the future
   - Must be within agent's office hours (if configured)

6. **Subject Generation:**
   - Priority: `stageName` → `dealSummary` → `dealId` → `fallbackSubject` → `customerName`

7. **Calendar Event Creation:**
   - Uses unified `CalendarService.createEvent()` (supports Microsoft & Google)
   - Creates online meeting (Teams/Meet) if `isOnlineMeeting: true`
   - Sends calendar invitations to attendees

8. **SMS Notification:**
   - If phone number available, sends SMS via Telnyx API
   - Includes meeting link (prioritizes online meeting URL over calendar link)

**Database Queries:**
- `getStageItemById(dealId)` - Fetch deal from `stage_items` table
- `getPipelineStageById(stageId)` - Fetch stage from `pipeline_stages` table
- `getPipelineById(boardId, clientId)` - Fetch pipeline from `pipelines` table
- `getPartyContactInfo(partyId, clientId)` - Two-step query:
  - `parties` table → Get `contacts_id`
  - `contacts` table → Get contact info
- `getCustomerWithFuzzySearch(customerName, clientId)` - Fuzzy search in `customers` table
- `getContactWithFuzzySearch(customerName, clientId)` - Fuzzy search in `contacts` table
- `getAgentWithCalendarByUUID(agentId, clientId)` - Fetch agent with calendar assignment
- `validateAgentHasCalendar(agentId, clientId, calendarId?)` - Validate agent calendar

**External API Calls:**
- `CalendarService.createEvent()` - Creates calendar event (Microsoft Graph / Google Calendar API)
- `Telnyx SMS API` - Sends SMS notification (if `TELNYX_API_KEY` configured)

**Response Format:**
```
APPOINTMENT BOOKED

Subject: {subject}
Date: {formatted date}
Time: {formatted time range}

Customer: {name} ({company})
Email: {email}

Agent: {profileName} - {title}

Location: {location}
Meeting Link: {joinUrl}

Event ID: {eventId}
Invitations sent to all attendees.
```

**Error Handling:**
- Returns conflict suggestions if time slot unavailable
- Returns alternative available slots if booking fails

---

### 3. **FindAvailableBookingSlots**
**Purpose:** Find available time slots for booking with an agent. Checks calendar availability and office hours.

**Input Schema:**
- `clientId` (number | string): Client ID
- `agentId` (string, UUID): Agent UUID
- `boardId` (string, UUID, optional): Pipeline UUID for calendar selection
- `stageId` (string, UUID, optional): Stage UUID for metadata
- `dealId` (number | string, optional): Deal ID for customer lookup
- `preferredDate` (string, required): Natural language date ("today", "tomorrow", "2025-12-06", "next monday")
- `durationMinutes` (number, optional, default: 60): Meeting duration (30, 60, 90)
- `maxSuggestions` (number, optional, default: 3): Number of slots to return (1-5)
- `calendarId` (string, optional): Calendar connection ID override

**Functionality Flow:**

1. **Metadata Resolution:** Same auto-inference as BookCustomerAppointment

2. **Date Parsing (Natural Language Support):**
   - Supports: "today", "tomorrow", "this monday", "next friday", "monday", "2025-12-06"
   - Parses in agent's timezone (not UTC)
   - Defaults to 9 AM - 6 PM business hours

3. **Calendar Availability Check:**
   - Uses `CalendarService.findAvailableSlots()`
   - Respects agent's office hours
   - Filters out existing calendar events
   - Returns slots within office hours only

4. **Slot Enhancement:**
   - Adds agent name and email to each slot
   - Formats times in human-readable format

**Database Queries:**
- Same metadata queries as BookCustomerAppointment
- `getAgentWithCalendarByUUID(agentId, clientId)` - Get agent with office hours

**External API Calls:**
- `CalendarService.findAvailableSlots()` - Queries calendar API for availability

**Response Format:**
```
AVAILABLE TIME SLOTS

Agent: {profileName}
Date: {preferredDate}
Duration: {durationMinutes} minutes

1. {startFormatted} - {endFormatted}
2. {startFormatted} - {endFormatted}
3. {startFormatted} - {endFormatted}

Use BookCustomerAppointment with one of these slots.
```

---

### 4. **CancelCustomerAppointment**
**Purpose:** Cancel an existing appointment and send cancellation notifications.

**Input Schema:**
- `clientId` (number | string): Client ID
- `agentId` (string, UUID): Agent UUID who owns the calendar
- `eventId` (string, required): Event ID from booking confirmation
- `calendarId` (string, optional): Calendar ID override
- `notifyCustomer` (boolean, optional, default: true): Send cancellation email

**Functionality:**
- Validates agent and calendar connection
- Deletes event via `CalendarService.deleteEvent()`
- Calendar provider automatically sends cancellation notifications

**Database Queries:**
- `validateAgentHasCalendar(agentId, clientId)`
- `getAgentWithCalendarByUUID(agentId, clientId)`

**External API Calls:**
- `CalendarService.deleteEvent()` - Deletes calendar event

**Response Format:**
```
APPOINTMENT CANCELLED

Event ID: {eventId}
Cancellation notifications sent to all attendees.
```

---

### 5. **RescheduleCustomerAppointment**
**Purpose:** Reschedule an existing appointment to a new time.

**Input Schema:**
- `clientId` (number | string): Client ID
- `agentId` (string, UUID): Agent UUID
- `eventId` (string, required): Event ID to reschedule
- `newStartDateTime` (string, required): New start time (ISO 8601)
- `newEndDateTime` (string, required): New end time (ISO 8601)
- `calendarId` (string, optional): Calendar ID override
- `notifyCustomer` (boolean, optional, default: true): Send update email

**Functionality:**
- Validates new time (must be 15+ minutes in future)
- Validates office hours
- Updates event via `CalendarService.updateEvent()`
- Calendar provider automatically sends update notifications

**Database Queries:**
- `validateAgentHasCalendar(agentId, clientId)`
- `getAgentWithCalendarByUUID(agentId, clientId)`
- `AdvancedCacheService.getClientCalendarData(clientId)` - Get client timezone

**External API Calls:**
- `CalendarService.updateEvent()` - Updates calendar event

**Response Format:**
```
APPOINTMENT RESCHEDULED

Subject: {subject}
New Date: {formatted date}
New Time: {formatted time range}

Event ID: {eventId}
Update notifications sent to all attendees.

Agent: {profileName}
```

---

## Database Schema Queries

### Tables Accessed:

1. **`agents`** - Agent information
2. **`agent_calendar_assignments`** - Links agents to calendar connections
3. **`calendar_connections`** - Calendar connection details (Microsoft/Google)
4. **`profiles`** - Agent profiles with office hours and timezone
5. **`customers`** - Customer database
6. **`contacts`** - Contact database
7. **`parties`** - Party entities (links to contacts)
8. **`pipelines`** - Pipeline/board definitions (with `calendar_id` for board-level calendars)
9. **`pipeline_stages`** - Pipeline stage definitions
10. **`stage_items`** - Deal/deal items (contains `party_id` and `pipeline_stage_id`)

### Key Query Patterns:

**Agent Lookup:**
```sql
SELECT * FROM agents 
WHERE uuid = ? AND client_id = ? AND deleted_at IS NULL
JOIN agent_calendar_assignments ON ...
JOIN calendar_connections ON ...
JOIN profiles ON ...
```

**Customer Lookup via Deal:**
```sql
-- Step 1: Get deal
SELECT id, pipeline_stage_id, party_id, summary 
FROM stage_items 
WHERE id = ? AND deleted_at IS NULL

-- Step 2: Get party
SELECT id, contacts_id, role_id 
FROM parties 
WHERE id = ? AND deleted_at IS NULL

-- Step 3: Get contact
SELECT id, name, first_name, last_name, email, phone_number, company 
FROM contacts 
WHERE id = ? AND client_id = ? AND deleted_at IS NULL
```

**Pipeline Metadata:**
```sql
-- Pipeline
SELECT id, name, client_id, calendar_id 
FROM pipelines 
WHERE id = ? AND client_id = ? AND deleted_at IS NULL

-- Stage
SELECT id, pipeline_id, name 
FROM pipeline_stages 
WHERE id = ? AND deleted_at IS NULL
```

---

## Context Fetching & Data Flow

### Auto-Inference Chain:
```
dealId → stageId → boardId → pipeline.calendar_id
```

1. **If `dealId` provided:**
   - Fetch `stage_items` → Get `pipeline_stage_id` → Auto-infer `stageId`
   - Fetch `stage_items` → Get `party_id` → Fetch customer/contact info

2. **If `stageId` provided (or inferred):**
   - Fetch `pipeline_stages` → Get `pipeline_id` → Auto-infer `boardId`

3. **If `boardId` provided (or inferred):**
   - Fetch `pipelines` → Get `calendar_id` → Use for calendar selection

### Calendar Selection Priority:
1. `request.calendarId` (explicit override)
2. `pipeline.calendar_id` (board-level calendar)
3. Agent's assigned calendar (from `agent_calendar_assignments`)

### Customer Lookup Priority:
1. **Deal-based lookup** (if `dealId` provided):
   - `deal.party_id` → `parties.contacts_id` → `contacts` table
2. **Fuzzy search in customers** (if `customerName` provided)
3. **Fuzzy search in contacts** (if not found in customers)
4. **Manual input** (from request parameters)

---

## External Dependencies

### Services:
- **CalendarService** - Unified calendar service (Microsoft Graph + Google Calendar)
- **AdvancedCacheService** - Client timezone and calendar data caching
- **Telnyx SMS API** - SMS notifications (optional, requires `TELNYX_API_KEY`)

### Utilities:
- **getAgentWithCalendarByUUID()** - Agent lookup with calendar
- **getAgentsForClient()** - List agents for client
- **validateAgentHasCalendar()** - Agent calendar validation
- **getCustomerWithFuzzySearch()** - Customer fuzzy search
- **getContactWithFuzzySearch()** - Contact fuzzy search
- **isWithinOfficeHours()** - Office hours validation
- **buildBookingSubject()** - Subject generation from metadata
- **getPipelineById()** - Pipeline lookup
- **getPipelineStageById()** - Stage lookup
- **getStageItemById()** - Deal lookup
- **getPartyContactInfo()** - Customer/contact lookup via party_id

---

## Key Features

1. **Multi-Calendar Support:** Microsoft (Graph API) and Google Calendar
2. **Auto-Inference:** Automatically infers `stageId` and `boardId` from `dealId`
3. **Smart Customer Lookup:** Multi-source customer lookup with priority
4. **Office Hours Validation:** Respects agent's configured office hours
5. **Conflict Detection:** Returns alternative slots if booking fails
6. **Natural Language Dates:** Supports "today", "tomorrow", "next monday", etc.
7. **SMS Notifications:** Sends SMS with meeting links (optional)
8. **Pipeline Integration:** Uses pipeline-level calendars when agent has no calendar
9. **Subject Generation:** Auto-generates meeting subjects from stage/deal metadata
10. **Timezone Handling:** Respects agent and client timezones

---

## Error Handling

All tools follow consistent error handling:
- Returns structured error messages
- Logs errors to console
- Returns user-friendly error text
- Provides alternative suggestions when applicable (e.g., conflict slots)

---

## Response Format

All tools return MCP-compliant responses:
```typescript
{
  content: [
    {
      type: "text",
      text: "Formatted response text"
    }
  ]
}
```

