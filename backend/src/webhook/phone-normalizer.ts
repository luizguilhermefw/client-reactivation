const MIN_PHONE_DIGITS = 8;
const MAX_PHONE_DIGITS = 15;

export function normalizeEvolutionPhone(remoteJid: unknown): string | null {
  if (typeof remoteJid !== 'string' || !remoteJid.trim()) {
    return null;
  }

  const withoutWhatsappSuffix = remoteJid
    .trim()
    .replace(/@s\.whatsapp\.net$/i, '');
  const address = withoutWhatsappSuffix.split('@', 1)[0];
  const phone = address.replace(/\D/g, '');

  if (phone.length < MIN_PHONE_DIGITS || phone.length > MAX_PHONE_DIGITS) {
    return null;
  }

  return phone;
}
