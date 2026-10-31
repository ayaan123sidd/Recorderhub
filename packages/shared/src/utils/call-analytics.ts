/** Accept explicit country codes, including legacy +00-prefixed dial strings. */
export const INTERNATIONAL_SIM_PHONE_PATTERN = /^(?:\+?00|\+)(?!91)[1-9]\d{6,14}$/;

export const WHATSAPP_DISPOSITION_PATTERN = /whatsapp/i;
export const WHATSAPP_CALL_KEY_PATTERN = /^WA_/i;

interface CallAnalyticsInput {
  direction?: string;
  channel?: string;
  disposition?: string;
  idempotencyKey?: string;
  phoneNumber?: string;
  phoneNumberMasked?: string;
}

/** Outbound cellular attempts to explicit non-Indian numbers; WhatsApp is excluded. */
export function isInternationalSimCall(call: CallAnalyticsInput): boolean {
  const channel = (call.channel ?? 'CELLULAR').trim().toUpperCase();
  const direction = (call.direction ?? '').trim().toUpperCase();

  if (!['CELLULAR', 'SIM'].includes(channel) || !['OUTGOING', 'OUTBOUND'].includes(direction)) {
    return false;
  }
  if (WHATSAPP_DISPOSITION_PATTERN.test(call.disposition ?? '') ||
      WHATSAPP_CALL_KEY_PATTERN.test(call.idempotencyKey ?? '')) {
    return false;
  }

  const phone = (call.phoneNumber || call.phoneNumberMasked || '').replace(/[\s().-]/g, '');
  return INTERNATIONAL_SIM_PHONE_PATTERN.test(phone);
}
