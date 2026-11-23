// Recognises bank card fields. The number itself never leaves the page: only "a card is being entered".

const FIELD_HINT =
  /(card.?(number|no|num)|cc.?(num|number)|cardnumber|kartennummer|num(e|é)ro.?de.?carte|n(u|ú)mero.?de.?tarjeta|номер.?карты|номер.?картки)/i;

/** Luhn checksum used by every bank card number. */
export function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = digits.charCodeAt(i) - 48;
    if (digit < 0 || digit > 9) return false;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return digits.length > 0 && sum % 10 === 0;
}

/** 13–19 digits (spaces and dashes allowed) that pass the Luhn check. */
export function looksLikeCardNumber(value: string): boolean {
  if (!/^[\d\s-]{13,23}$/.test(value)) return false;
  const digits = value.replace(/[\s-]/g, '');
  return digits.length >= 13 && digits.length <= 19 && luhnValid(digits);
}

export interface FieldHints {
  autocomplete: string;
  name: string;
  id: string;
  placeholder: string;
  label: string;
}

export function isCardField(hints: FieldHints): boolean {
  if (/\bcc-number\b/i.test(hints.autocomplete)) return true;
  return FIELD_HINT.test(`${hints.name} ${hints.id} ${hints.placeholder} ${hints.label}`);
}
