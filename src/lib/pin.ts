/** PIN personnel : exactement 4 ou 6 chiffres. */
export const PIN_FORMAT_RE = /^(\d{4}|\d{6})$/

export function sanitizePinInput(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 6)
}

export function isValidPinFormat(pin: string): boolean {
  return PIN_FORMAT_RE.test(pin)
}
