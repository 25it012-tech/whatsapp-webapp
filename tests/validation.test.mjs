import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMessage, validateUsername, isUuid } from '../lib/validation.mjs';

test('messages are trimmed without losing internal whitespace', () => {
  assert.equal(validateMessage('  hello\nfriend  '), 'hello\nfriend');
});
test('empty, non-text, and oversized messages are rejected', () => {
  for (const value of ['', '  ', null, 123, 'a'.repeat(4001)]) {
    assert.throws(() => validateMessage(value));
  }
  assert.equal(validateMessage('a'.repeat(4000)).length, 4000);
});
test('usernames are normalized and validated', () => {
  assert.equal(validateUsername(' Alice_123 '), 'alice_123');
  for (const value of ['ab', '1alice', 'a b c', '<script>', null, 'a'.repeat(25)]) {
    assert.throws(() => validateUsername(value));
  }
});
test('only UUID-shaped strings are accepted as contact IDs', () => {
  assert.equal(isUuid('123e4567-e89b-42d3-a456-426614174000'), true);
  for (const value of ['', null, {}, 'not-a-uuid', '123e4567-e89b-42d3-a456-426614174000x']) {
    assert.equal(isUuid(value), false);
  }
});
