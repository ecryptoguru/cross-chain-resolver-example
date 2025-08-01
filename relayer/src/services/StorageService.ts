/**
 * Storage service for persistent message tracking
 * Provides secure file-based storage with proper error handling
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { IStorageService } from '../types/interfaces.js';
import { StorageError, ErrorHandler } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export class StorageService implements IStorageService {
  private readonly processedMessages: Set<string> = new Set();
  private readonly storageDir: string;
  private readonly filename: string;
  private isInitialized = false;

  constructor(storageDir: string = 'storage', filename: string = 'processed_messages.json') {
    this.storageDir = this.validateAndNormalizePath(storageDir);
    this.filename = this.validateFilename(filename);
  }

  /**
   * Initialize the storage service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      await this.ensureStorageDirectory();
      await this.loadProcessedMessages();
      this.isInitialized = true;
      logger.info('Storage service initialized successfully', {
        storageDir: this.storageDir,
        filename: this.filename,
        loadedMessages: this.processedMessages.size
      });
    } catch (error) {
      throw ErrorHandler.handleAndRethrow(
        error as Error,
        'StorageService initialization failed'
      );
    }
  }

  /**
   * Save a processed message to persistent storage
   */
  async saveProcessedMessage(messageId: string): Promise<void> {
    try {
      this.validateMessageId(messageId);
      
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Add to in-memory set first
      this.processedMessages.add(messageId);

      // Persist to file
      await this.persistToFile();

      logger.debug('Saved processed message', { messageId, totalMessages: this.processedMessages.size });
    } catch (error) {
      throw new StorageError(
        `Failed to save processed message: ${messageId}`,
        'save',
        this.getStorageFilePath(),
        { messageId, error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * Load processed messages from persistent storage
   */
  async loadProcessedMessages(): Promise<Set<string>> {
    try {
      const filePath = this.getStorageFilePath();

      try {
        await fs.access(filePath);
        const data = await fs.readFile(filePath, 'utf8');
        
        if (!data.trim()) {
          logger.info('Storage file is empty, starting with empty message set');
          return this.processedMessages;
        }

        const messages = JSON.parse(data);

        if (!Array.isArray(messages)) {
          throw new StorageError(
            'Invalid storage format: expected array',
            'load',
            filePath,
            { actualType: typeof messages }
          );
        }

        // Validate and load messages
        let validMessages = 0;
        messages.forEach((messageId: unknown) => {
          if (typeof messageId === 'string' && messageId.trim()) {
            try {
              this.validateMessageId(messageId);
              this.processedMessages.add(messageId);
              validMessages++;
            } catch (error) {
              logger.warn('Skipping invalid message ID from storage', { 
                messageId, 
                error: error instanceof Error ? error.message : String(error) 
              });
            }
          }
        });

        logger.info('Loaded processed messages from storage', {
          totalMessages: messages.length,
          validMessages,
          skippedMessages: messages.length - validMessages
        });

        return this.processedMessages;
      } catch (accessError: any) {
        if (accessError.code === 'ENOENT') {
          logger.info('No storage file found, starting with empty message set');
          return this.processedMessages;
        }
        throw accessError;
      }
    } catch (error) {
      if (error instanceof StorageError) {
        throw error;
      }
      
      throw new StorageError(
        'Failed to load processed messages from storage',
        'load',
        this.getStorageFilePath(),
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * Check if a message has been processed
   */
  isMessageProcessed(messageId: string): boolean {
    try {
      this.validateMessageId(messageId);
      return this.processedMessages.has(messageId);
    } catch (error) {
      logger.warn('Invalid message ID in isMessageProcessed check', { 
        messageId, 
        error: error instanceof Error ? error.message : String(error) 
      });
      return false;
    }
  }

  /**
   * Get the count of processed messages
   */
  getProcessedMessageCount(): number {
    return this.processedMessages.size;
  }

  /**
   * Clear all processed messages (use with caution)
   */
  async clearProcessedMessages(): Promise<void> {
    try {
      this.processedMessages.clear();
      await this.persistToFile();
      logger.info('Cleared all processed messages');
    } catch (error) {
      throw new StorageError(
        'Failed to clear processed messages',
        'clear',
        this.getStorageFilePath(),
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * Get all processed message IDs (for debugging/monitoring)
   */
  getAllProcessedMessages(): string[] {
    return Array.from(this.processedMessages);
  }

  // Private helper methods

  private validateMessageId(messageId: string): void {
    if (!messageId || typeof messageId !== 'string' || !messageId.trim()) {
      throw ErrorHandler.createValidationError(
        'messageId',
        messageId,
        'Message ID must be a non-empty string'
      );
    }

    if (messageId.length > 256) {
      throw ErrorHandler.createValidationError(
        'messageId',
        messageId,
        'Message ID is too long (max 256 characters)'
      );
    }
  }

  private validateFilename(filename: string): string {
    if (!filename || typeof filename !== 'string') {
      throw ErrorHandler.createSecurityError('Invalid filename provided', { filename });
    }

    // Prevent directory traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      throw ErrorHandler.createSecurityError('Directory traversal attempt detected', { filename });
    }

    // Ensure filename has safe characters only
    if (!/^[a-zA-Z0-9_.-]+$/.test(filename)) {
      throw ErrorHandler.createSecurityError('Unsafe characters in filename', { filename });
    }

    return filename;
  }

  private validateAndNormalizePath(dirPath: string): string {
    if (!dirPath || typeof dirPath !== 'string') {
      throw ErrorHandler.createSecurityError('Invalid directory path provided', { dirPath });
    }

    // Prevent directory traversal
    if (dirPath.includes('..')) {
      throw ErrorHandler.createSecurityError('Directory traversal attempt detected', { dirPath });
    }

    // Normalize and resolve the path
    const normalizedPath = path.resolve(process.cwd(), dirPath);
    
    // Ensure the path is within the project directory
    const projectRoot = process.cwd();
    if (!normalizedPath.startsWith(projectRoot)) {
      throw ErrorHandler.createSecurityError('Path outside project directory', { 
        dirPath, 
        normalizedPath, 
        projectRoot 
      });
    }

    return normalizedPath;
  }

  private getStorageFilePath(): string {
    return path.join(this.storageDir, this.filename);
  }

  private async ensureStorageDirectory(): Promise<void> {
    try {
      await fs.access(this.storageDir);
    } catch {
      try {
        await fs.mkdir(this.storageDir, { recursive: true });
        logger.info('Created storage directory', { storageDir: this.storageDir });
      } catch (error) {
        throw new StorageError(
          'Failed to create storage directory',
          'mkdir',
          this.storageDir,
          { error: error instanceof Error ? error.message : String(error) }
        );
      }
    }
  }

  private async persistToFile(): Promise<void> {
    const filePath = this.getStorageFilePath();
    const tempFile = `${filePath}.tmp`;

    try {
      // Convert Set to Array for JSON serialization
      const messages = Array.from(this.processedMessages);
      const data = JSON.stringify(messages, null, 2);

      // Write to temporary file first (atomic operation)
      await fs.writeFile(tempFile, data, 'utf8');
      
      // Rename to final file (atomic on most filesystems)
      await fs.rename(tempFile, filePath);

      logger.debug('Persisted messages to storage', { 
        messageCount: messages.length, 
        filePath 
      });
    } catch (error) {
      // Clean up temp file if it exists
      try {
        await fs.unlink(tempFile);
      } catch {
        // Ignore cleanup errors
      }

      throw new StorageError(
        'Failed to persist messages to file',
        'write',
        filePath,
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }
}
