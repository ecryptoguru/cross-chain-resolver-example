import { test } from 'node:test';
import assert from 'node:assert';

test('Simple test to verify test runner works', async () => {
  assert.strictEqual(1 + 1, 2, 'Basic math should work');
  assert.ok(true, 'True should be truthy');
});

test('Async test example', async () => {
  const result = await Promise.resolve('test');
  assert.strictEqual(result, 'test', 'Promise should resolve correctly');
});

test('Error handling test', async () => {
  try {
    throw new Error('Test error');
  } catch (error) {
    assert.ok(error instanceof Error, 'Should catch error correctly');
    assert.strictEqual((error as Error).message, 'Test error', 'Error message should match');
  }
});
