import { isInternationalSimCall } from '@recordhub/shared';

describe('International SIM call analytics', () => {
  const outgoingSim = { direction: 'OUTGOING', channel: 'CELLULAR' };

  it.each([
    '+971 50 123 4567', '+1 (212) 555-1234', '+44 20 7946 0958', '+92 313 2323522',
    '0044 20 7946 0958', '00 971 50 123 4567', '+0044 20 7946 0958',
  ])('counts an outgoing SIM call to %s', (phoneNumber) => {
    expect(isInternationalSimCall({ ...outgoingSim, phoneNumber })).toBe(true);
  });

  it.each([
    '+91 98765 43210', '+9 1 (98765) 43210', '0091 98765 43210', '+0091 98765 43210',
    '9876543210', '09876543210', '919876543210', '971501234567',
    '', 'Private Number', 'Contact +971501234567', '+971 ** 1234567', '+999',
    '+0123456789', '+971501234567890123',
  ])('excludes domestic, ambiguous or malformed number %s', (phoneNumber) => {
    expect(isInternationalSimCall({ ...outgoingSim, phoneNumber })).toBe(false);
  });

  it.each(['WHATSAPP', 'WHATSAPP_WEB', 'VOIP'])('excludes %s calls', (channel) => {
    expect(isInternationalSimCall({ ...outgoingSim, channel, phoneNumber: '+971501234567' })).toBe(false);
  });

  it.each([
    { disposition: 'WhatsApp Call' }, { disposition: 'WhatsApp Web Call' },
    { idempotencyKey: 'WA_12345' }, { idempotencyKey: 'WA_LOG-12345' },
  ])('excludes legacy WhatsApp markers %p', (markers) => {
    expect(isInternationalSimCall({ ...outgoingSim, ...markers, phoneNumber: '+971501234567' })).toBe(false);
  });

  it.each(['INCOMING', 'INBOUND', 'MISSED', ''])('excludes direction %s', (direction) => {
    expect(isInternationalSimCall({ ...outgoingSim, direction, phoneNumber: '+971501234567' })).toBe(false);
  });

  it('accepts the SIM/OUTBOUND aliases and legacy cellular records without a channel', () => {
    expect(isInternationalSimCall({ channel: ' sim ', direction: ' outbound ', phoneNumber: '+971501234567' })).toBe(true);
    expect(isInternationalSimCall({ direction: 'OUTGOING', phoneNumber: '+971501234567' })).toBe(true);
  });

  it('uses the legacy number field only when the primary number is missing', () => {
    expect(isInternationalSimCall({ ...outgoingSim, phoneNumberMasked: '+971501234567' })).toBe(true);
    expect(isInternationalSimCall({ ...outgoingSim, phoneNumber: '', phoneNumberMasked: '+971501234567' })).toBe(true);
    expect(isInternationalSimCall({ ...outgoingSim, phoneNumber: '+919876543210', phoneNumberMasked: '+971501234567' })).toBe(false);
  });
});
