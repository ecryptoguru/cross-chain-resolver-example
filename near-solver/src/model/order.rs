use near_sdk::{
    borsh::{self, BorshDeserialize, BorshSerialize},
    env, near_bindgen,
    serde::{Deserialize, Serialize},
    AccountId, Balance, log, Promise, PromiseResult,
};
use std::collections::HashMap;
use std::str::FromStr;
use std::fmt;

// Re-export the event module
pub use crate::event::ContractEvent;

// Import TEE attestation
use crate::tee::TeeAttestation;

// Custom error type for validation
#[derive(Debug, PartialEq, Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub enum ValidationError {
    /// The order has expired
    OrderExpired,
    /// The order is not in a valid state for this operation
    InvalidOrderState,
    /// The order amount is invalid
    InvalidAmount,
    /// The order hashlock is invalid
    InvalidHashlock,
    /// The order timelock is invalid
    InvalidTimelock,
    /// The order chain is not supported
    UnsupportedChain,
    /// The order token is not supported
    UnsupportedToken,
    /// The order recipient is invalid
    InvalidRecipient,
    /// The order ID is invalid
    InvalidOrderId,
    /// The TEE attestation is invalid
    InvalidTeeAttestation(String),
    /// The account ID is invalid
    InvalidAccountId,
    /// Other error
    Other(String),
}

impl std::fmt::Display for ValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::OrderExpired => write!(f, "Order has expired"),
            Self::InvalidOrderState => write!(f, "Order is not in a valid state for this operation"),
            Self::InvalidAmount => write!(f, "Amount must be greater than 0"),
            Self::InvalidHashlock => write!(f, "Invalid hashlock format (expected 64 character hex)"),
            Self::InvalidTimelock => write!(f, "Timelock must be in the future"),
            Self::UnsupportedChain => write!(f, "Unsupported chain"),
            Self::UnsupportedToken => write!(f, "Unsupported token"),
            Self::InvalidRecipient => write!(f, "Invalid recipient address"),
            Self::InvalidOrderId => write!(f, "Invalid order ID format"),
            Self::InvalidAccountId => write!(f, "Invalid account ID format"),
            Self::InvalidTeeAttestation(msg) => write!(f, "Invalid TEE attestation: {}", msg),
            Self::Other(msg) => write!(f, "Order error: {}", msg),
        }
    }
}

impl std::error::Error for ValidationError {}

/// Represents the status of a cross-chain swap order
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde")]
pub enum OrderStatus {
    /// Order has been created but not yet processed
    Created,
    /// Order is being processed by the solver
    Processing,
    /// Order has been successfully filled
    Filled,
    /// Order has been cancelled
    Cancelled,
    /// Order has expired
    Expired,
    /// Order has failed with a reason
    Failed(String),
}

impl fmt::Display for OrderStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Created => write!(f, "created"),
            Self::Processing => write!(f, "processing"),
            Self::Filled => write!(f, "filled"),
            Self::Cancelled => write!(f, "cancelled"),
            Self::Expired => write!(f, "expired"),
            Self::Failed(reason) => write!(f, "failed: {}", reason),
        }
    }
}

/// Represents a cross-chain swap order
#[near_bindgen]
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Debug, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct CrossChainOrder {
    /// Unique identifier for the order
    pub id: String,
    /// Source chain (e.g., "ethereum", "near")
    pub source_chain: String,
    /// Destination chain
    pub dest_chain: String,
    /// Token address on the source chain
    pub source_token: String,
    /// Token address on the destination chain
    pub dest_token: String,
    /// Amount of tokens to swap (in the smallest unit)
    pub amount: u128,
    /// Minimum amount of tokens to receive (slippage protection)
    pub min_amount_out: u128,
    /// Address of the user who created the order
    pub creator: AccountId,
    /// Recipient address on the destination chain
    pub recipient: String,
    /// Current status of the order
    pub status: OrderStatus,
    /// When the order was created (UNIX timestamp in seconds)
    pub created_at: u64,
    /// When the order expires (UNIX timestamp in seconds)
    pub expires_at: u64,
    /// Hash of the secret for the hashlock
    pub hashlock: String,
    /// TEE attestation ID (if required)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tee_attestation_id: Option<String>,
    /// Additional metadata (if any)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<HashMap<String, String>>,
    /// When the order was last updated (UNIX timestamp in seconds)
    pub updated_at: u64,
}

impl CrossChainOrder {
    /// Gets the current timestamp in seconds
    fn current_timestamp() -> u64 {
        env::block_timestamp() / 1_000_000_000 // Convert to seconds
    }
    
    /// Creates a new error event
    fn emit_error(&self, message: impl Into<String>, details: Option<String>) {
        ContractEvent::emit_error(
            Some(self.id.clone()),
            message,
            details,
        );
    }
    
    /// Emits an error event for a failed promise result
    fn emit_promise_error(&self, result: &PromiseResult, context: &str) {
        ContractEvent::emit_promise_error(
            Some(self.id.clone()),
            result,
            context,
        );
    }
    /// Validates order parameters
    pub fn validate_params(
        id: &str,
        source_chain: &str,
        source_token: &str,
        source_amount: u128,
        source_address: &str,
        dest_chain: &str,
        dest_token: &str,
        dest_amount: u128,
        dest_address: &str,
        hashlock: &str,
        timelock: u64,
    ) -> Result<(), ValidationError> {
        // Check if the order has expired
        let now = Self::current_timestamp();
        if timelock <= now {
            return Err(ValidationError::OrderExpired);
        }
        
        // Validate amounts
        if source_amount == 0 || dest_amount == 0 {
            return Err(ValidationError::InvalidAmount);
        }
        
        // Validate hashlock (should be a 64-character hex string)
        if hashlock.len() != 64 || !hashlock.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(ValidationError::InvalidHashlock);
        }
        
        // Validate chains (basic check)
        if source_chain.is_empty() || dest_chain.is_empty() {
            return Err(ValidationError::UnsupportedChain);
        }
        
        // Validate tokens (basic check)
        if source_token.is_empty() || dest_token.is_empty() {
            return Err(ValidationError::UnsupportedToken);
        }
        
        // Validate addresses
        if source_address.is_empty() || dest_address.is_empty() {
            return Err(ValidationError::InvalidRecipient);
        }
        
        // Validate order ID
        if id.is_empty() || id.len() > 128 {
            return Err(ValidationError::InvalidOrderId);
        }
        // Validate order ID
        if id.is_empty() || id.len() > 64 {
            return Err(ValidationError::InvalidOrderId);
        }

        // Validate chains
        if !is_valid_chain(source_chain) || !is_valid_chain(dest_chain) {
            return Err(ValidationError::UnsupportedChain);
        }

        // Validate amounts
        if source_amount == 0 || dest_amount == 0 {
            return Err(ValidationError::InvalidAmount);
        }

        // Validate addresses based on chain
        if source_chain.eq_ignore_ascii_case("near") && !is_valid_near_account(source_address) {
            return Err(ValidationError::InvalidAccountId);
        }
        if dest_chain.eq_ignore_ascii_case("near") && !is_valid_near_account(dest_address) {
            return Err(ValidationError::InvalidAccountId);
        }

        // Validate hashlock (64 character hex string)
        if hashlock.len() != 64 || !hashlock.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(ValidationError::InvalidHashlock);
        }

        // Validate timelock is in the future
        let now = env::block_timestamp() / 1_000_000; // Convert to seconds
        if timelock <= now {
            return Err(ValidationError::InvalidTimelock);
        }

        // Validate token formats
        if !is_valid_token_format(source_token) || !is_valid_token_format(dest_token) {
            return Err(ValidationError::UnsupportedToken);
        }

        Ok(())
    }

    /// Creates a new cross-chain order with validation
    pub fn new(
        id: String,
        source_chain: String,
        source_token: String,
        source_amount: u128,
        source_address: String,
        dest_chain: String,
        dest_token: String,
        dest_amount: u128,
        dest_address: String,
        hashlock: String,
        timelock: u64,
    ) -> Result<Self, ValidationError> {
        // Validate parameters first
        Self::validate_params(
            &id,
            &source_chain,
            &source_token,
            source_amount,
            &source_address,
            &dest_chain,
            &dest_token,
            dest_amount,
            &dest_address,
            &hashlock,
            timelock,
        )?;
        // Validate all parameters
        Self::validate_params(
            &id,
            &source_chain,
            &source_token,
            source_amount,
            &source_address,
            &dest_chain,
            &dest_token,
            dest_amount,
            &dest_address,
            &hashlock,
            timelock,
        )?;

        let now = env::block_timestamp() / 1_000_000; // Convert to seconds
        
        Ok(Self {
            id,
            source_chain,
            source_token,
            source_amount,
            source_address,
            dest_chain,
            dest_token,
            dest_amount,
            dest_address,
            hashlock,
            timelock,
            status: OrderStatus::Created,
            created_at: now,
            updated_at: now,
            metadata: None,
            min_amount_out: dest_amount, // Default to dest_amount if not specified
            creator: env::predecessor_account_id(),
            recipient: dest_address.clone(),
            expires_at: timelock,
            tee_attestation_id: None,
        })
    }

    /// Updates the order status and emits an event
    pub fn update_status(&mut self, new_status: OrderStatus) -> bool {
        if self.status == new_status {
            return false; // No change
        }
        
        let old_status = std::mem::replace(&mut self.status, new_status);
        self.updated_at = Self::current_timestamp();
        
        // Emit status change event
        log!(
            "Order status changed: {} -> {} for order {}",
            self.status_to_string(&old_status),
            self.status_to_string(&self.status),
            self.id
        );
        
        // Emit event
        event::emit_event(ContractEvent::OrderStatusChanged {
            order_id: self.id.clone(),
            old_status,
            new_status: self.status.clone(),
            timestamp: self.updated_at,
        });
        
        true
    }
    
    /// Converts OrderStatus to a string representation
    pub fn status_to_string(&self, status: &OrderStatus) -> String {
        match status {
            OrderStatus::Created => "Created".to_string(),
            OrderStatus::Processing => "Processing".to_string(),
            OrderStatus::Filled => "Filled".to_string(),
            OrderStatus::Cancelled => "Cancelled".to_string(),
            OrderStatus::Expired => "Expired".to_string(),
            OrderStatus::Failed(reason) => format!("Failed: {}", reason),
        }
    }
    
    /// Checks if the order is still valid (not expired, not filled, not cancelled)
    pub fn is_valid(&self) -> bool {
        match self.status {
            OrderStatus::Created | OrderStatus::Processing => {
                // Check if order has expired
                Self::current_timestamp() <= self.expires_at
            }
            _ => false,
        }
    }

    /// Adds metadata to the order
    pub fn add_metadata(&mut self, key: String, value: String) {
        if self.metadata.is_none() {
            self.metadata = Some(HashMap::new());
        }
        if let Some(metadata) = &mut self.metadata {
            metadata.insert(key, value);
        }
    }
}

// Helper functions for validation
fn is_valid_near_account(account_id: &str) -> bool {
    // Basic NEAR account ID validation
    // 1. Length between 2 and 64 characters
    // 2. Only lowercase alphanumeric or separators (._-)
    // 3. Cannot start or end with a separator
    // 4. Cannot have two separators in a row
    if account_id.len() < 2 || account_id.len() > 64 {
        return false;
    }
    
    let mut prev_char = None;
    for c in account_id.chars() {
        if !(c.is_ascii_lowercase() || c.is_ascii_digit() || c == '.' || c == '_' || c == '-') {
            return false;
        }
        if let Some(pc) = prev_char {
            if (pc == '.' || pc == '_' || pc == '-') && (c == '.' || c == '_' || c == '-') {
                return false; // Two separators in a row
            }
        }
        prev_char = Some(c);
    }
    
    // Check first and last character
    let first_char = account_id.chars().next().unwrap();
    let last_char = account_id.chars().last().unwrap();
    if first_char == '.' || first_char == '_' || first_char == '-' ||
       last_char == '.' || last_char == '_' || last_char == '-' {
        return false;
    }
    
    true
}

fn is_valid_token_format(token: &str) -> bool {
    // Check if it's a NEAR token (format: account_id:token_id)
    if token.contains(':') {
        let parts: Vec<&str> = token.split(':').collect();
        if parts.len() != 2 {
            return false;
        }
        return is_valid_near_account(parts[0]);
    }
    
    // Check if it's a standard NEAR account ID
    is_valid_near_account(token)
}

fn is_valid_chain(chain: &str) -> bool {
    // Add more supported chains as needed
    matches!(chain.to_lowercase().as_str(), "near" | "ethereum" | "aurora")
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::{testing_env, VMContext};
    use near_sdk::test_utils::VMContextBuilder;
    use std::panic;

    fn get_context() -> VMContext {
        VMContextBuilder::new()
            .signer_account_id("bob.near".parse().unwrap())
            .is_view(false)
            .block_timestamp(1_000_000_000_000) // Some timestamp in the past
            .build()
    }

    fn create_test_order() -> CrossChainOrder {
        let now = env::block_timestamp() / 1_000_000;
        CrossChainOrder {
            id: "test-order".to_string(),
            status: OrderStatus::Created,
            source_chain: "ethereum".to_string(),
            source_token: "0xTokenAddress".to_string(),
            source_amount: 1000000000000000000, // 1 token with 18 decimals
            source_address: "0xUserAddress".to_string(),
            dest_chain: "near".to_string(),
            dest_token: "wrap.near".to_string(),
            dest_amount: 1000000000000000000, // 1 token with 24 decimals
            dest_address: "user.near".to_string(),
            hashlock: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2".to_string(),
            timelock: now + 3600, // 1 hour from now
            created_at: now,
            updated_at: now,
            metadata: None,
        }
    }

    #[test]
    fn test_order_creation() {
        let context = get_context();
        testing_env!(context);
        
        let now = env::block_timestamp() / 1_000_000;
        
        let order = CrossChainOrder::new(
            "test-order".to_string(),
            "ethereum".to_string(),
            "0xTokenAddress".to_string(),
            1000000000000000000, // 1 token with 18 decimals
            "0xUserAddress".to_string(),
            "near".to_string(),
            "wrap.near".to_string(),
            1000000000000000000, // 1 token with 24 decimals
            "user.near".to_string(),
            "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2".to_string(),
            now + 3600, // 1 hour from now
        );
        
        assert!(order.is_ok());
        let order = order.unwrap();
        
        assert_eq!(order.id, "test-order");
        assert_eq!(order.status, OrderStatus::Created);
        assert_eq!(order.source_chain, "ethereum");
        assert_eq!(order.dest_chain, "near");
    }
    
    #[test]
    fn test_invalid_order_creation() {
        let context = get_context();
        testing_env!(context);
        
        let now = env::block_timestamp() / 1_000_000;
        
        // Test with empty order ID
        let result = CrossChainOrder::new(
            "".to_string(), // Empty ID
            "ethereum".to_string(),
            "0xTokenAddress".to_string(),
            1000000000000000000,
            "0xUserAddress".to_string(),
            "near".to_string(),
            "wrap.near".to_string(),
            1000000000000000000,
            "user.near".to_string(),
            "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2".to_string(),
            now + 3600,
        );
        
        assert!(matches!(result, Err(ValidationError::InvalidOrderId)));
        
        // Test with invalid hashlock
        let result = CrossChainOrder::new(
            "test-order".to_string(),
            "ethereum".to_string(),
            "0xTokenAddress".to_string(),
            1000000000000000000,
            "0xUserAddress".to_string(),
            "near".to_string(),
            "wrap.near".to_string(),
            1000000000000000000,
            "user.near".to_string(),
            "invalid-hash".to_string(), // Invalid hashlock
            now + 3600,
        );
        
        assert!(matches!(result, Err(ValidationError::InvalidHashlock)));
    }
    
    #[test]
    fn test_order_status_update() {
        let context = get_context();
        testing_env!(context);
        
        let mut order = create_test_order();
        
        // Initial status should be Created
        assert_eq!(order.status, OrderStatus::Created);
        
        // Update to Processing
        let changed = order.update_status(OrderStatus::Processing);
        assert!(changed);
        assert_eq!(order.status, OrderStatus::Processing);
        
        // Try updating to the same status
        let changed = order.update_status(OrderStatus::Processing);
        assert!(!changed); // Should return false for no change
        
        // Update to Filled
        let changed = order.update_status(OrderStatus::Filled);
        assert!(changed);
        assert_eq!(order.status, OrderStatus::Filled);
        order.add_metadata("tx_hash".to_string(), "0x1234".to_string());
        assert!(order.metadata.is_some());
        assert_eq!(
            order.metadata.unwrap().get("tx_hash").unwrap(),
            "0x1234"
        );
    }
}
