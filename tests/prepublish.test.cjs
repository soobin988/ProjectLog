const test = require('node:test');
const assert = require('node:assert/strict');
const { responseText } = require('../services/openai-response');

test('invalid OpenAI responses produce safe application errors', () => {
  for (const response of [undefined, null, {}, { status: 'completed' }, { status: 'completed', output_text: 42 }]) {
    assert.throws(() => responseText(response), { code: 'empty_response' });
  }
  assert.throws(() => responseText({ status: 'incomplete', output_text: 'partial', incomplete_details: { reason: 'max_output_tokens' } }), { code: 'max_output_tokens' });
  assert.equal(responseText({ status: 'completed', output_text: ' complete ' }), 'complete');
});
