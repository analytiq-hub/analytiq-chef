/**
 * Replace _FN_ with the contact's first name (Dux-Soup-style placeholder).
 * @param {string} text
 * @param {string} firstName
 * @returns {string}
 */
function replaceFnPlaceholder(text, firstName) {
  const fn = firstName == null ? "" : String(firstName);
  return text.replace(/_FN_/g, fn);
}
