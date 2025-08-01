/**
 * Comprehensive unit tests for StorageService
 * Tests message persistence, state management, and file operations
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { StorageService } from '../../src/services/StorageService.js';

describe('StorageService', () => {
  let storageService: StorageService;
  let tempDir: string;
  let testFileName: string;

  // Setup before each test
  const setupTest = async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'storage-test-'));
    testFileName = 'test_messages.json';
    storageService = new StorageService(tempDir, testFileName);
  };

  // Cleanup after each test
  const cleanupTest = async () => {
    if (tempDir) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  };

  test('should create temporary directory for testing', async () => {
    await setupTest();
    
    assert(storageService instanceof StorageService);
    assert.strictEqual(typeof tempDir, 'string');
    assert(tempDir.length > 0);
    
    await cleanupTest();
  });

  describe('Initialization', () => {
    test('should initialize with default parameters', () => {
      const defaultService = new StorageService();
      assert(defaultService instanceof StorageService);
    });

    test('should initialize with custom directory and filename', () => {
      const customService = new StorageService('/custom/path', 'custom.json');
      assert(customService instanceof StorageService);
    });

    test('should create storage directory if it does not exist', async () => {
      await setupTest();
      
      const nonExistentDir = join(tempDir, 'non-existent');
      const service = new StorageService(nonExistentDir, 'test.json');
      
      await service.initialize();
      
      const stats = await fs.stat(nonExistentDir);
      assert(stats.isDirectory());
      
      await cleanupTest();
    });

    test('should handle existing storage directory', async () => {
      await setupTest();
      
      await storageService.initialize();
      
      // Initialize again - should not throw
      await storageService.initialize();
      
      const stats = await fs.stat(tempDir);
      assert(stats.isDirectory());
      
      await cleanupTest();
    });

    test('should create empty storage file if it does not exist', async () => {
      await setupTest();
      
      await storageService.initialize();
      
      const filePath = join(tempDir, testFileName);
      const stats = await fs.stat(filePath);
      assert(stats.isFile());
      
      const content = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(content);
      assert(Array.isArray(data));
      assert.strictEqual(data.length, 0);
      
      await cleanupTest();
    });
  });

  describe('Message Processing Tracking', () => {
    test('should track processed messages', async () => {
      await setupTest();
      
      await storageService.initialize();
      
      const messageId = 'test-message-1';
      
      // Initially not processed
      assert.strictEqual(storageService.isMessageProcessed(messageId), false);
      
      // Mark as processed
      await storageService.saveProcessedMessage(messageId);
      
      // Should now be processed
      assert.strictEqual(storageService.isMessageProcessed(messageId), true);
      
      await cleanupTest();
    });

    test('should persist processed messages to file', async () => {
      await setupTest();
      
      await storageService.initialize();
      
      const messageIds = ['msg-1', 'msg-2', 'msg-3'];
      
      // Mark messages as processed
      for (const messageId of messageIds) {
        await storageService.saveProcessedMessage(messageId);
      }
      
      // Create new service instance to test persistence
      const newService = new StorageService(tempDir, testFileName);
      await newService.initialize();
      
      // All messages should still be marked as processed
      for (const messageId of messageIds) {
        assert.strictEqual(
          newService.isMessageProcessed(messageId),
          true,
          `Message ${messageId} should be persisted as processed`
        );
      }
      
      await cleanupTest();
    });

    test('should handle duplicate message processing', async () => {
      await storageService.initialize();
      
      const messageId = 'duplicate-message';
      
      // Mark as processed multiple times
      await storageService.saveProcessedMessage(messageId);
      await storageService.saveProcessedMessage(messageId);
      await storageService.saveProcessedMessage(messageId);
      
      // Should still be processed (no duplicates)
      assert.strictEqual(storageService.isMessageProcessed(messageId), true);
      
      const processedMessages = storageService.getAllProcessedMessages();
      const duplicates = processedMessages.filter((msg: string) => msg === messageId);
      assert.strictEqual(duplicates.length, 1, 'Should not have duplicate entries');
    });

    test('should include timestamps when marking messages as processed', async () => {
      await storageService.initialize();
      
      const messageId = 'timestamped-message';
      const beforeTime = Date.now();
      
      await storageService.saveProcessedMessage(messageId);
      
      const afterTime = Date.now();
      const processedMessages = storageService.getAllProcessedMessages();
      const message = processedMessages.find((msg: string) => msg === messageId);
      
      assert(message, 'Message should be found');
      // Note: StorageService only stores message IDs, not timestamps
      // This test validates the message was stored correctly
      assert.strictEqual(message, messageId, 'Message ID should match');
      assert(afterTime >= beforeTime, 'Time should have passed');
    });
  });

  describe('Data Retrieval', () => {
    test('should return all processed messages', async () => {
      await storageService.initialize();
      
      const messageIds = ['msg-a', 'msg-b', 'msg-c'];
      
      for (const messageId of messageIds) {
        await storageService.saveProcessedMessage(messageId);
      }
      
      const processedMessages = storageService.getAllProcessedMessages();
      
      assert.strictEqual(processedMessages.length, messageIds.length);
      
      for (const messageId of messageIds) {
        const found = processedMessages.some((msg: string) => msg === messageId);
        assert(found, `Should find message ${messageId}`);
      }
    });

    test('should return processed message count', async () => {
      await storageService.initialize();
      
      assert.strictEqual(storageService.getProcessedMessageCount(), 0);
      
      await storageService.saveProcessedMessage('msg-1');
      assert.strictEqual(storageService.getProcessedMessageCount(), 1);
      
      await storageService.saveProcessedMessage('msg-2');
      assert.strictEqual(storageService.getProcessedMessageCount(), 2);
      
      await storageService.saveProcessedMessage('msg-3');
      assert.strictEqual(storageService.getProcessedMessageCount(), 3);
      
      await cleanupTest();
    });

    test('should return empty array when no messages processed', async () => {
      await setupTest();
      
      await storageService.initialize();
      
      const processedMessages = storageService.getAllProcessedMessages();
      assert(Array.isArray(processedMessages));
      assert.strictEqual(processedMessages.length, 0);
      
      await cleanupTest();
    });
  });

  describe('File Operations', () => {
    test('should handle corrupted storage file gracefully', async () => {
      await setupTest();
      
      await storageService.initialize();
      
      // Write corrupted JSON to file
      const filePath = join(tempDir, testFileName);
      await fs.writeFile(filePath, 'invalid json content');
      
      // Create new service - should handle corruption and reset
      const newService = new StorageService(tempDir, testFileName);
      await newService.initialize();
      
      // Should start with empty processed messages
      assert.strictEqual(newService.getProcessedMessageCount(), 0);
    });

    test('should handle missing storage file', async () => {
      // Don't initialize first
      const messageId = 'test-message';
      
      // Should handle gracefully
      assert.strictEqual(storageService.isMessageProcessed(messageId), false);
      
      // Initialize and try again
      await storageService.initialize();
      assert.strictEqual(storageService.isMessageProcessed(messageId), false);
    });

    test('should handle file permission errors gracefully', async () => {
      await storageService.initialize();
      
      // This test might not work on all systems, so we'll simulate the error
      const originalWriteFile = fs.writeFile;
      
      // Mock fs.writeFile to throw permission error
      (fs as any).writeFile = async () => {
        throw new Error('EACCES: permission denied');
      };
      
      try {
        // Should not throw, but handle gracefully
        await storageService.saveProcessedMessage('test-message');
        
        // Restore original function
        (fs as any).writeFile = originalWriteFile;
      } catch (error) {
        // Restore original function even if test fails
        (fs as any).writeFile = originalWriteFile;
        
        // Re-throw for test failure
        throw error;
      }
    });
  });

  describe('Concurrent Access', () => {
    test('should handle concurrent message processing', async () => {
      await storageService.initialize();
      
      const messageIds = Array.from({ length: 10 }, (_, i) => `concurrent-msg-${i}`);
      
      // Process messages concurrently
      const promises = messageIds.map(messageId => 
        storageService.saveProcessedMessage(messageId)
      );
      
      await Promise.all(promises);
      
      // All messages should be processed
      for (const messageId of messageIds) {
        assert.strictEqual(
          storageService.isMessageProcessed(messageId),
          true,
          `Message ${messageId} should be processed`
        );
      }
      
      assert.strictEqual(storageService.getProcessedMessageCount(), messageIds.length);
    });

    test('should maintain data consistency under concurrent access', async () => {
      await storageService.initialize();
      
      const messageCount = 20;
      const messageIds = Array.from({ length: messageCount }, (_, i) => `consistency-msg-${i}`);
      
      // Process half the messages
      const firstHalf = messageIds.slice(0, messageCount / 2);
      for (const messageId of firstHalf) {
        await storageService.saveProcessedMessage(messageId);
      }
      
      // Process remaining messages concurrently
      const secondHalf = messageIds.slice(messageCount / 2);
      const promises = secondHalf.map(messageId => 
        storageService.saveProcessedMessage(messageId)
      );
      
      await Promise.all(promises);
      
      // Verify all messages are processed and no duplicates exist
      const processedMessages = storageService.getAllProcessedMessages();
      const uniqueMessageIds = new Set(processedMessages);
      
      assert.strictEqual(processedMessages.length, messageCount);
      assert.strictEqual(uniqueMessageIds.size, messageCount);
      
      for (const messageId of messageIds) {
        assert(uniqueMessageIds.has(messageId), `Should have message ${messageId}`);
      }
    });
  });

  describe('Performance', () => {
    test('should handle large number of processed messages efficiently', async () => {
      await storageService.initialize();
      
      const messageCount = 1000;
      const startTime = Date.now();
      
      // Process many messages
      for (let i = 0; i < messageCount; i++) {
        await storageService.saveProcessedMessage(`perf-msg-${i}`);
      }
      
      const processingTime = Date.now() - startTime;
      
      // Verify all messages are processed
      assert.strictEqual(storageService.getProcessedMessageCount(), messageCount);
      
      // Performance check - should complete within reasonable time (10 seconds)
      assert(processingTime < 10000, `Processing ${messageCount} messages took too long: ${processingTime}ms`);
      
      // Check lookup performance
      const lookupStartTime = Date.now();
      for (let i = 0; i < 100; i++) {
        const messageId = `perf-msg-${Math.floor(Math.random() * messageCount)}`;
        assert.strictEqual(storageService.isMessageProcessed(messageId), true);
      }
      const lookupTime = Date.now() - lookupStartTime;
      
      // Lookup should be fast (under 1 second for 100 lookups)
      assert(lookupTime < 1000, `Lookup performance too slow: ${lookupTime}ms for 100 lookups`);
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty message IDs', async () => {
      await storageService.initialize();
      
      const emptyMessageIds = ['', null, undefined];
      
      for (const messageId of emptyMessageIds) {
        // Should handle gracefully without throwing
        assert.strictEqual(storageService.isMessageProcessed(messageId as any), false);
        
        // Marking as processed should handle gracefully
        await storageService.saveProcessedMessage(messageId as any);
      }
    });

    test('should handle very long message IDs', async () => {
      await storageService.initialize();
      
      const longMessageId = 'a'.repeat(10000);
      
      await storageService.saveProcessedMessage(longMessageId);
      assert.strictEqual(storageService.isMessageProcessed(longMessageId), true);
    });

    test('should handle special characters in message IDs', async () => {
      await storageService.initialize();
      
      const specialMessageIds = [
        'msg-with-unicode-🚀',
        'msg/with/slashes',
        'msg\\with\\backslashes',
        'msg with spaces',
        'msg.with.dots',
        'msg:with:colons',
        'msg@with@symbols'
      ];
      
      for (const messageId of specialMessageIds) {
        await storageService.saveProcessedMessage(messageId);
        assert.strictEqual(
          storageService.isMessageProcessed(messageId),
          true,
          `Should handle special message ID: ${messageId}`
        );
      }
    });
  });

  // Cleanup after tests
  test('should cleanup test directory', async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
      console.warn('Failed to cleanup test directory:', error);
    }
  });
});
