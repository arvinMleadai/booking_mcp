# 🔧 Teams Meeting Link Troubleshooting Guide

## 🚨 **Issue**: Teams Meeting Link Not Showing in Outlook

If you're not seeing the Teams meeting link in your Outlook calendar after booking an appointment with `isOnlineMeeting: true`, here are the potential causes and solutions:

## 🔍 **Diagnostic Steps**

### **1. Check the Console Logs**
When creating a meeting, look for these log messages:
```
💻 Teams meeting requested with provider: teamsForBusiness
✅ Teams meeting created successfully:
   Join URL: https://teams.microsoft.com/l/meetup-join/...
   Conference ID: 123456789
```

If you see:
```
⚠️ Teams meeting was requested but not created in the response
```
This indicates Microsoft Graph didn't create the Teams meeting.

### **2. Verify Microsoft Graph API Permissions**
Your Microsoft Graph application needs these permissions:
- `Calendars.ReadWrite` ✅ (You have this)
- `OnlineMeetings.ReadWrite` ❌ (You might be missing this)
- `User.Read` ✅ (You have this)

## 🛠️ **Solutions**

### **Solution 1: Add Missing API Permissions**

1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to **Azure Active Directory** > **App registrations**
3. Find your calendar application
4. Go to **API permissions**
5. Click **Add a permission**
6. Select **Microsoft Graph** > **Application permissions**
7. Add: `OnlineMeetings.ReadWrite`
8. Click **Grant admin consent**

### **Solution 2: Enable Teams Meeting Add-in in Outlook**

1. Open Outlook
2. Go to **File** > **Options** > **Add-ins**
3. Under **Manage COM Add-ins**, click **Go**
4. Ensure **Microsoft Teams Meeting Add-in for Microsoft Office** is checked
5. Restart Outlook

### **Solution 3: Update Account Configuration**

Ensure you're using the same Microsoft 365 account for:
- Your calendar application authentication
- Outlook client
- Microsoft Teams

### **Solution 4: Alternative Meeting Creation Method**

If Microsoft Graph isn't creating Teams meetings automatically, we've added fallback content to the meeting body that will show:

```
--- Microsoft Teams Meeting ---
Join the meeting from your calendar or use the Teams app.
```

## 🔧 **Code Improvements Made**

### **Enhanced Teams Meeting Creation**
```typescript
if (request.isOnlineMeeting) {
  eventData.isOnlineMeeting = true
  eventData.onlineMeetingProvider = 'teamsForBusiness'
  
  // Add Teams meeting information to the body
  const teamsInfo = '\n\n--- Microsoft Teams Meeting ---\nJoin the meeting from your calendar or use the Teams app.\n'
  if (eventData.body) {
    eventData.body.content += teamsInfo
  } else {
    eventData.body = {
      contentType: 'html',
      content: `<p>Meeting details:</p>${teamsInfo.replace(/\n/g, '<br>')}`
    }
  }
}
```

### **Enhanced Logging**
- Added detailed logging for Teams meeting creation
- Shows join URL and conference ID when successful
- Warns when Teams meeting creation fails

## 🎯 **Testing Steps**

1. **Create a test meeting** with `isOnlineMeeting: true`
2. **Check console logs** for Teams meeting creation messages
3. **Look in Outlook** for the meeting details
4. **Check email invitation** for Teams meeting link
5. **Verify meeting body** contains Teams meeting information

## 📞 **Expected Behavior**

### **When Working Correctly:**
- Outlook shows Teams meeting button/link
- Email invitation contains join link
- Meeting body has Teams meeting details
- Console shows successful Teams meeting creation

### **When Permissions Are Missing:**
- Meeting is created but no Teams link
- Console shows warning about missing Teams meeting
- Meeting body still contains Teams meeting placeholder text

## 🚀 **Next Steps**

1. **Check your Azure app permissions** (most likely cause)
2. **Test with a new meeting** after adding permissions
3. **Verify Outlook add-in** is enabled
4. **Check console logs** during meeting creation

If the issue persists after checking permissions, the problem might be:
- Microsoft 365 license limitations
- Tenant-level Teams policies
- Network/firewall restrictions

## 📧 **Support Information**

If you continue having issues:
1. Share the console logs from meeting creation
2. Verify your Azure app permissions
3. Test with a different Microsoft 365 account
4. Check if other users in your organization have the same issue

The enhanced logging will help identify exactly where the Teams meeting creation is failing.
