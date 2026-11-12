const MAX_FLEXIBLE_PHONE_DIGITS = 15;

/**
 * Escapes all special regular expression characters so user input is matched literally.
 */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds a MongoDB-safe case-insensitive regex clause for phone fields.
 * - Escapes '+' and other regex metacharacters (preventing invalid regex crashes on '+92', '(318)', etc.).
 * - Allows optional formatting separators (spaces, dashes, parens, dots) between digits so '+92 318',
 *   '+92318', and '+92-318' match regardless of how the number is stored in MongoDB.
 */
export function buildPhoneSearchRegex(rawTerm: string): { $regex: string; $options: 'i' } {
  const term = rawTerm.trim();
  const escaped = escapeRegex(term);
  const isPhoneLike = /^[+\d\s().-]+$/.test(term) && /\d/.test(term);

  if (!isPhoneLike) {
    return { $regex: escaped, $options: 'i' };
  }

  const digits = term.replace(/\D/g, '').slice(0, MAX_FLEXIBLE_PHONE_DIGITS);
  if (!digits) {
    return { $regex: escaped, $options: 'i' };
  }

  const flexibleDigits = digits.split('').join('[\\s().-]*');

  if (term.startsWith('+')) {
    // Match explicit '+' (e.g. '+92...') or '00' international dialing prefix (e.g. '0092...')
    return { $regex: `(?:\\+|^00)[\\s().-]*${flexibleDigits}`, $options: 'i' };
  }

  if (digits.length >= 2) {
    return { $regex: flexibleDigits, $options: 'i' };
  }

  return { $regex: escaped, $options: 'i' };
}

export interface RegexCondition {
  $regex: string;
  $options: 'i';
}

/**
 * Builds the MongoDB $or filter array for call search across phone and text fields.
 */
export function buildCallSearchOrClauses(
  rawTerm: string,
  textFields: string[] = ['leadName', 'agentName'],
  phoneFields: string[] = ['phoneNumber', 'phoneNumberMasked']
): Record<string, RegexCondition>[] {
  const term = rawTerm.trim();
  const textRegex: RegexCondition = { $regex: escapeRegex(term), $options: 'i' };
  const phoneRegex: RegexCondition = buildPhoneSearchRegex(term);

  return [
    ...phoneFields.map((field) => ({ [field]: phoneRegex })),
    ...textFields.map((field) => ({ [field]: textRegex })),
  ];
}
