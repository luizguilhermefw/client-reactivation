const MIN_PHONE_DIGITS = 8;
const MAX_PHONE_DIGITS = 15;

export function normalizeEvolutionPhone(remoteJid: unknown): string | null {
  if (typeof remoteJid !== 'string' || !remoteJid.trim()) {
    return null;
  }

  const address = remoteJid.trim();
  const whatsappJid = /^(\d+)@s\.whatsapp\.net$/i.exec(address);

  if (address.includes('@') && !whatsappJid) {
    return null;
  }

  const phone = (whatsappJid?.[1] ?? address).replace(/\D/g, '');

  if (phone.length < MIN_PHONE_DIGITS || phone.length > MAX_PHONE_DIGITS) {
    return null;
  }

  return phone;
}
