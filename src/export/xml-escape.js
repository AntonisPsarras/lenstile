/**
 * Dependency-free XML escaping for 3MF / OPC text content and attributes.
 */

/**
 * Escape text for safe inclusion in XML element content or attribute values.
 * Escapes: & < > " '
 * @param {string} value
 * @returns {string}
 */
export function escapeXml(value) {
  const s = value == null ? "" : String(value);
  let out = "";
  for (let i = 0; i < s.length; i += 1) {
    const ch = s.charAt(i);
    switch (ch) {
      case "&":
        out += "&amp;";
        break;
      case "<":
        out += "&lt;";
        break;
      case ">":
        out += "&gt;";
        break;
      case '"':
        out += "&quot;";
        break;
      case "'":
        out += "&apos;";
        break;
      default:
        out += ch;
    }
  }
  return out;
}
