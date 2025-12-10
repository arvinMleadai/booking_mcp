# Microsoft Graph Calendar Integration Setup

This document outlines the Microsoft Graph calendar functionality for the MCP server.

## Prerequisites

1. **Existing OAuth Implementation**: Your app already handles Microsoft OAuth authentication
2. **Database Credentials**: Microsoft Graph credentials are stored in `lead_dialer.calendar_connections`
3. **Environment Variables**: Microsoft Graph API credentials for token refresh

## Environment Variables

Add these environment variables to your `.env.local` file for token refresh functionality:

```env
# Microsoft Graph Configuration (for token refresh)
MICROSOFT_CLIENT_ID=your_application_client_id
MICROSOFT_CLIENT_SECRET=your_client_secret_value
```

## Database Schema

The implementation uses your existing `lead_dialer.calendar_connections` table with the following expected structure:

```sql
-- Your existing table structure
lead_dialer.calendar_connections (
  id uuid,
  client_id integer,
  user_id uuid,
  provider_id uuid,
  provider_name text,
  provider_user_id text,
  email text,
  display_name text,
  access_token text,
  refresh_token text,
  token_type text,
  expires_at timestamp with time zone,
  calendars jsonb,
  is_connected boolean,
  last_sync_at timestamp with time zone,
  sync_status text,
  sync_error text,
  provider_metadata jsonb,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
)
```

## API Endpoints

### Microsoft Graph MCP Tools
Base URL: `/api/calendar/graph`

Available tools:
- `GetCalendarEvents` - Retrieve calendar events
- `CreateCalendarEvent` - Create new calendar events
- `UpdateCalendarEvent` - Update existing events
- `DeleteCalendarEvent` - Delete calendar events
- `SearchCalendarEvents` - Search events by subject
- `GetCalendars` - List available calendars
- `CheckCalendarConnection` - Check connection status
- `GetAvailability` - Get free/busy information

## Usage Flow

1. **Check Connection** (assumes OAuth already completed in your app):
   ```json
   {
     "tool": "CheckCalendarConnection",
     "arguments": {
       "clientId": 10000001
     }
   }
   ```

3. **Get Events**:
   ```json
   {
     "tool": "GetCalendarEvents",
     "arguments": {
       "clientId": 10000001,
       "timeZone": "Australia/Melbourne",
       "dateRequest": "today"
     }
   }
   ```

4. **Create Event**:
   ```json
   {
     "tool": "CreateCalendarEvent",
     "arguments": {
       "clientId": 10000001,
       "timeZone": "Australia/Melbourne",
       "subject": "Meeting with Client",
       "startDateTime": "2024-09-25T10:00:00+10:00",
       "endDateTime": "2024-09-25T11:00:00+10:00",
       "attendeeEmail": "client@example.com",
       "attendeeName": "John Doe",
       "description": "Discuss project requirements",
       "location": "Conference Room A",
       "isOnlineMeeting": true
     }
   }
   ```

## Security Considerations

1. **Token Storage**: Access tokens are stored encrypted in the database
2. **Token Refresh**: Tokens are automatically refreshed when they expire
3. **State Parameter**: OAuth flow uses state parameter to prevent CSRF attacks
4. **Scopes**: Only request necessary permissions
5. **HTTPS**: Use HTTPS in production for OAuth redirects

## Troubleshooting

### Common Issues

1. **"Invalid redirect URI"**
   - Ensure the redirect URI in Azure matches exactly with your environment variable
   - Check that the URI is registered in Azure App Registration

2. **"Insufficient privileges"**
   - Ensure API permissions are granted and admin consent is provided
   - Check that the user has appropriate calendar permissions

3. **"Token expired"**
   - The system should automatically refresh tokens
   - Check that refresh tokens are being stored properly

4. **"Calendar connection not found"**
   - User needs to complete OAuth flow first
   - Check database for calendar_connections record

### Debug Steps

1. Check environment variables are set correctly
2. Verify database tables exist and have correct schema
3. Check Azure App Registration configuration
4. Review server logs for detailed error messages
5. Test OAuth flow manually using the auth endpoint

## Integration with Existing OAuth

Since your app already handles Microsoft OAuth authentication and stores credentials in the database:

1. **No additional OAuth setup needed** - the MCP tools will use existing stored credentials
2. **Automatic token refresh** - expired access tokens are automatically refreshed using stored refresh tokens
3. **Seamless integration** - tools work with any client that has Microsoft calendar connected via your existing OAuth flow

## API Rate Limits

Microsoft Graph has rate limits:
- **Per app per tenant**: 10,000 requests per 10 minutes
- **Per user per app**: 1,000 requests per 10 minutes

The implementation includes automatic retry logic and respects rate limits.
