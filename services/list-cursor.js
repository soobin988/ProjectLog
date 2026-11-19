function encodeCursor(values) {
  return Buffer.from(JSON.stringify(values)).toString('base64url');
}

function decodeCursor(value) {
  if (typeof value !== 'string' || value.length > 512) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString());
    return Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

module.exports = { encodeCursor, decodeCursor };
