use near_sdk::{
    borsh::{self, BorshDeserialize, BorshSerialize},
    env, near_bindgen,
    serde::{Deserialize, Serialize},
    AccountId, log, PromiseResult,
};
use schemars::JsonSchema;
use std::collections::HashMap;
use std::fmt;

// Re-export the event module
pub use crate::event::ContractEvent;

// Custom error type for validation
#[derive(Debug, PartialEq, Serialize, Deserialize, JsonSchema)]
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

/// Represents a single fill event for partial order fulfillment
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, JsonSchema, Debug, Clone, PartialEq)]
#[serde(crate = "near_sdk::serde")]
pub struct FillEvent {
    /// Unique identifier for this fill
    pub fill_id: String,
    /// Amount filled in this event
    pub filled_amount: u128,
    /// Timestamp when this fill occurred
    pub timestamp: u64,
    /// Transaction hash or identifier for this fill
    pub tx_hash: Option<String>,
    /// Solver or relayer that executed this fill
    pub executor: String,
    /// Additional metadata for this fill
    pub metadata: Option<HashMap<String, String>>,
}

/// Represents the status of a cross-chain swap order
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, JsonSchema, Debug, Clone, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde")]
pub enum OrderStatus {
    /// Order has been created but not yet processed
    Created,
    /// Order is being processed by the solver
    Processing,
    /// Order has been partially filled
    PartiallyFilled,
    /// Order has been successfully filled completely
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
            Self::PartiallyFilled => write!(f, "partially_filled"),
            Self::Filled => write!(f, "filled"),
            Self::Cancelled => write!(f, "cancelled"),
            Self::Expired => write!(f, "expired"),
            Self::Failed(reason) => write!(f, "failed: {}", reason),
        }
    }
}

/// Represents a cross-chain swap order
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, JsonSchema, Debug, Clone)]
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
    /// Amount of source tokens (for compatibility)
    pub source_amount: u128,
    /// Amount of destination tokens expected
    pub dest_amount: u128,
    /// Source address (user who created the order)
    pub source_address: String,
    /// Destination address (recipient)
    pub dest_address: String,
    /// Minimum amount of tokens to receive (slippage protection)
    pub min_amount_out: u128,
    /// The NEAR account ID that created this order
    #[schemars(with = "String")]
    pub creator: AccountId,
    /// Recipient address on the destination chain
    pub recipient: String,
    /// Current status of the order
    pub status: OrderStatus,
    /// When the order was created (UNIX timestamp in seconds)
    pub created_at: u64,
    /// When the order expires (UNIX timestamp in seconds)
    pub expires_at: u64,
    /// Timelock expiration (UNIX timestamp in seconds)
    pub timelock: u64,
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
    
    // ========== Partial Fill Support Fields ==========
    /// Total amount that has been filled so far
    pub filled_amount: u128,
    /// Remaining amount to be filled
    pub remaining_amount: u128,
    /// History of all fill events for this order
    pub fill_history: Vec<FillEvent>,
    /// Parent order ID if this is a split order
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_order_id: Option<String>,
    /// Child order IDs if this order has been split
    pub child_order_ids: Vec<String>,
    /// Minimum fill amount (orders below this won't be processed)
    pub min_fill_amount: u128,
    /// Maximum number of fills allowed for this order
    pub max_fills: u32,
    /// Current number of fills executed
    pub fill_count: u32,
    /// Whether this order allows partial fills
    pub allow_partial_fills: bool,
}

impl CrossChainOrder {
    /// Gets the current timestamp in seconds
    fn current_timestamp() -> u64 {
        env::block_timestamp() / 1_000_000_000 // Convert to seconds
    }
    
    /// Creates a new error event
    #[allow(dead_code)]
    fn emit_error(&self, message: impl Into<String>, details: Option<String>) {
        ContractEvent::emit_error(
            Some(self.id.clone()),
            message,
            details,
        );
    }
    
    /// Emits an error event for a failed promise result
    #[allow(dead_code)]
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

        let now = Self::current_timestamp();
        let creator = env::signer_account_id();

        Ok(Self {
            id,
            source_chain,
            dest_chain,
            source_token,
            dest_token,
            amount: source_amount, // For compatibility
            source_amount,
            dest_amount,
            source_address,
            dest_address,
            min_amount_out: dest_amount, // Default to exact amount
            creator,
            recipient: dest_address.clone(),
            status: OrderStatus::Created,
            created_at: now,
            expires_at: timelock,
            timelock,
            hashlock,
            tee_attestation_id: None,
            metadata: None,
            updated_at: now,
            // Initialize partial fill fields
            filled_amount: 0,
            remaining_amount: source_amount,
            fill_history: Vec::new(),
            parent_order_id: None,
            child_order_ids: Vec::new(),
            min_fill_amount: source_amount / 100, // Default to 1% minimum
            max_fills: 10, // Default maximum fills
            fill_count: 0,
            allow_partial_fills: true, // Default to allowing partial fills
        })
    }

    /// Updates the order status and emits an event
    pub fn update_status(&mut self, new_status: OrderStatus) -> bool {
        if self.status == new_status {
            return false; // No change
        }
        
        let old_status = std::mem::replace(&mut self.status, new_status.clone());
        self.updated_at = Self::current_timestamp();
        
        // Emit status change event
        log!(
            "Order status changed: {} -> {} for order {}",
            self.status_to_string(&old_status),
            self.status_to_string(&new_status),
            self.id
        );
        
        // Emit event
        let event = ContractEvent::OrderStatusChanged {
            order_id: self.id.clone(),
            old_status: old_status.clone(),
            new_status: new_status.clone(),
            timestamp: self.updated_at,
        };
        event.emit();
        
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
        if let Some(ref mut metadata) = self.metadata {
            metadata.insert(key, value);
        }
        self.updated_at = Self::current_timestamp();
    }

    // ========== Partial Fill Methods ==========
    
    /// Process a partial fill for this order
    pub fn process_partial_fill(
        &mut self, 
        fill_amount: u128, 
        executor: String,
        tx_hash: Option<String>
    ) -> Result<FillEvent, ValidationError> {
        // Validate partial fill is allowed
        if !self.allow_partial_fills {
            return Err(ValidationError::Other("Partial fills not allowed for this order".to_string()));
        }
        
        // Check if order can accept more fills
        if self.fill_count >= self.max_fills {
            return Err(ValidationError::Other("Maximum fills reached".to_string()));
        }
        
        // Validate fill amount
        if fill_amount == 0 {
            return Err(ValidationError::InvalidAmount);
        }
        
        if fill_amount < self.min_fill_amount {
            return Err(ValidationError::Other("Fill amount below minimum".to_string()));
        }
        
        if fill_amount > self.remaining_amount {
            return Err(ValidationError::Other("Fill amount exceeds remaining amount".to_string()));
        }
        
        // Check if order is in valid state for filling
        if !matches!(self.status, OrderStatus::Created | OrderStatus::Processing | OrderStatus::PartiallyFilled) {
            return Err(ValidationError::InvalidOrderState);
        }
        
        // Create fill event
        let fill_id = format!("{}-fill-{}", self.id, self.fill_count + 1);
        let fill_event = FillEvent {
            fill_id: fill_id.clone(),
            filled_amount: fill_amount,
            timestamp: Self::current_timestamp(),
            tx_hash,
            executor,
            metadata: None,
        };
        
        // Update order state
        self.filled_amount += fill_amount;
        self.remaining_amount -= fill_amount;
        self.fill_count += 1;
        self.fill_history.push(fill_event.clone());
        self.updated_at = Self::current_timestamp();
        
        // Update order status based on remaining amount
        if self.remaining_amount == 0 {
            self.update_status(OrderStatus::Filled);
        } else {
            self.update_status(OrderStatus::PartiallyFilled);
        }
        
        log!("Processed partial fill: {} amount {} for order {}", 
             fill_id, fill_amount, self.id);
        
        Ok(fill_event)
    }
    
    /// Split this order into smaller orders
    pub fn split_order(&self, split_amounts: Vec<u128>) -> Result<Vec<CrossChainOrder>, ValidationError> {
        // Validate split is allowed
        if !self.allow_partial_fills {
            return Err(ValidationError::Other("Order splitting not allowed".to_string()));
        }
        
        // Validate order state
        if !matches!(self.status, OrderStatus::Created) {
            return Err(ValidationError::InvalidOrderState);
        }
        
        // Validate split amounts
        let total_split: u128 = split_amounts.iter().sum();
        if total_split != self.remaining_amount {
            return Err(ValidationError::Other("Split amounts don't match remaining amount".to_string()));
        }
        
        // Check minimum amounts
        for &amount in &split_amounts {
            if amount < self.min_fill_amount {
                return Err(ValidationError::Other("Split amount below minimum".to_string()));
            }
        }
        
        let mut child_orders = Vec::new();
        
        for (i, &split_amount) in split_amounts.iter().enumerate() {
            let child_id = format!("{}-split-{}", self.id, i + 1);
            
            // Calculate proportional dest_amount
            let proportional_dest_amount = (self.dest_amount * split_amount) / self.source_amount;
            
            let child_order = CrossChainOrder {
                id: child_id,
                source_chain: self.source_chain.clone(),
                dest_chain: self.dest_chain.clone(),
                source_token: self.source_token.clone(),
                dest_token: self.dest_token.clone(),
                amount: split_amount,
                source_amount: split_amount,
                dest_amount: proportional_dest_amount,
                source_address: self.source_address.clone(),
                dest_address: self.dest_address.clone(),
                min_amount_out: (self.min_amount_out * split_amount) / self.source_amount,
                creator: self.creator.clone(),
                recipient: self.recipient.clone(),
                status: OrderStatus::Created,
                created_at: Self::current_timestamp(),
                expires_at: self.expires_at,
                timelock: self.timelock,
                hashlock: self.hashlock.clone(),
                tee_attestation_id: self.tee_attestation_id.clone(),
                metadata: self.metadata.clone(),
                updated_at: Self::current_timestamp(),
                // Partial fill fields for child order
                filled_amount: 0,
                remaining_amount: split_amount,
                fill_history: Vec::new(),
                parent_order_id: Some(self.id.clone()),
                child_order_ids: Vec::new(),
                min_fill_amount: self.min_fill_amount,
                max_fills: self.max_fills,
                fill_count: 0,
                allow_partial_fills: self.allow_partial_fills,
            };
            
            child_orders.push(child_order);
        }
        
        log!("Split order {} into {} child orders", self.id, child_orders.len());
        
        Ok(child_orders)
    }
    
    /// Check if order needs refund for unfilled portion
    pub fn needs_refund(&self) -> bool {
        let current_time = Self::current_timestamp();
        
        // Order needs refund if it's expired and has unfilled amount
        (current_time > self.expires_at || current_time > self.timelock) &&
        self.remaining_amount > 0 &&
        matches!(self.status, OrderStatus::PartiallyFilled | OrderStatus::Created | OrderStatus::Processing)
    }
    
    /// Calculate refund amount for unfilled portion
    pub fn calculate_refund_amount(&self) -> u128 {
        if self.needs_refund() {
            self.remaining_amount
        } else {
            0
        }
    }
    
    /// Get fill progress as percentage (0-100)
    pub fn get_fill_percentage(&self) -> u8 {
        if self.source_amount == 0 {
            return 0;
        }
        
        let percentage = (self.filled_amount * 100) / self.source_amount;
        std::cmp::min(percentage as u8, 100)
    }
    
    /// Check if order is completely filled
    pub fn is_completely_filled(&self) -> bool {
        self.remaining_amount == 0 && self.status == OrderStatus::Filled
    }
    
    /// Check if order is partially filled
    pub fn is_partially_filled(&self) -> bool {
        self.filled_amount > 0 && self.remaining_amount > 0 && self.status == OrderStatus::PartiallyFilled
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
    // Check if it's an Ethereum token address (0x followed by 40 hex chars)
    if token.starts_with("0x") && token.len() == 42 {
        return token[2..].chars().all(|c| c.is_ascii_hexdigit());
    }
    
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
            source_chain: "ethereum".to_string(),
            dest_chain: "near".to_string(),
            source_token: "0xTokenAddress".to_string(),
            dest_token: "wrap.near".to_string(),
            amount: 1000000000000000000, // 1 token with 18 decimals
            source_amount: 1000000000000000000, // 1 token with 18 decimals
            dest_amount: 1000000000000000000, // 1 token with 24 decimals
            source_address: "0xUserAddress".to_string(),
            dest_address: "user.near".to_string(),
            min_amount_out: 950000000000000000, // 95% of dest_amount (slippage protection)
            creator: "test.near".parse().unwrap(),
            recipient: "user.near".to_string(),
            status: OrderStatus::Created,
            created_at: now,
            expires_at: now + 3600, // 1 hour from now
            timelock: now + 3600, // 1 hour from now
            hashlock: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2".to_string(),
            tee_attestation_id: None,
            metadata: None,
            updated_at: now,
            // Initialize partial fill fields for test
            filled_amount: 0,
            remaining_amount: 1000000000000000000,
            fill_history: Vec::new(),
            parent_order_id: None,
            child_order_ids: Vec::new(),
            min_fill_amount: 10000000000000000, // 1% minimum
            max_fills: 10,
            fill_count: 0,
            allow_partial_fills: true,
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
            "0xA0b86a33E6441c8C06DD2b7c94b7E5c88b5c5c5c".to_string(),
            1000000000000000000, // 1 token with 18 decimals
            "0xB1c96a33E6441c8C06DD2b7c94b7E5c88b5c5c5c".to_string(),
            "near".to_string(),
            "wrap.near".to_string(),
            1000000000000000000, // 1 token with 24 decimals
            "user.near".to_string(),
            "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2".to_string(),
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
