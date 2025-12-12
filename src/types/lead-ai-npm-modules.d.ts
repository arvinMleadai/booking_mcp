declare module 'lead-ai-npm-modules' {
  /**
   * Send SMS using Telnyx API
   * @param phone_number - Phone number in E.164 format (e.g., +1234567890)
   * @param smsBody - Message body text
   * @param telnyxApiKey - Telnyx API key
   * @returns Promise with SMS response
   */
  export function sendSMS(
    phone_number: string,
    smsBody: string,
    telnyxApiKey: string
  ): Promise<any>

  export function initiateCall(
    phoneCallPayload: any,
    authToken: string
  ): Promise<any>

  export function convertToVapiCallPayload(
    phone_number: string,
    script: string,
    agentName: string,
    vapiIntegration: any
  ): any

  export function initiateCallUsingRecentActiveAgent(
    phone_number: string,
    script: string,
    clientId: number,
    vapiIntegration: any
  ): Promise<any>

  export function createEmailRaw(
    toEmail: string,
    fromEmail: string,
    subject: string,
    emailBody: string
  ): string

  export function handleRefreshToken(
    refreshToken: string,
    provider: string,
    microsoftClientId: string,
    microsoftClientSecret: string,
    googleClientId: string,
    googleClientSecret: string
  ): Promise<any>

  export function sendGmail(
    accessToken: string,
    recipientEmail: string,
    fromEmail: string,
    emailBody: string
  ): Promise<any>

  export function sendEmailFromStageTask(
    emailData: any,
    recipientEmail: string,
    emailBody: string,
    microsoftClientId: string,
    microsoftClientSecret: string,
    googleClientId: string,
    googleClientSecret: string
  ): Promise<any>

  export function sendOutlookMail(
    accessToken: string,
    recipientEmail: string,
    fromEmail: string,
    emailBody: string
  ): Promise<any>
}

