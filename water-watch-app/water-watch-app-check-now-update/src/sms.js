import twilio from 'twilio';

export async function sendSms({ to, body }) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  if (!to) {
    console.log('[SMS skipped] No destination number set. Message:', body);
    return { sent: false, reason: 'No destination number set' };
  }

  if (!sid || !token || !from) {
    console.log('[SMS log-only mode]', { to, body });
    return { sent: false, reason: 'Twilio not configured', to, body };
  }

  const client = twilio(sid, token);
  const result = await client.messages.create({ to, from, body });
  return { sent: true, sid: result.sid };
}
