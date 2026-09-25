export function validateMessage(value) {
  if (typeof value !== 'string') throw new Error('Enter a text message.');
  const message = value.trim();
  if (!message || message.length > 4000) throw new Error('Messages must contain 1–4000 characters.');
  return message;
}

export function validateUsername(value) {
  if (typeof value !== 'string') throw new Error('Enter a username.');
  const username = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{2,24}$/.test(username) || username.length > 24) {
    throw new Error('Use 3–24 lowercase letters, numbers, or underscores; start with a letter.');
  }
  return username;
}

export function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
