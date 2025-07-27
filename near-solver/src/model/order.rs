use near_sdk::{
    borsh::{self, BorshDeserialize, BorshSerialize},
    serde::{Deserialize, Serialize},
    AccountId,
};
use std::collections::HashMap;

/// Represents the status of a cross-chain swap order
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Debug, Clone, PartialEq)]
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
    /// Order failed with an error
    Failed(String),
}

/// Represents a cross-chain swap order
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Debug, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct CrossChainOrder {
    /// Unique identifier for the order
    pub id: String,
    /// Current status of the order
    pub status: OrderStatus,
    
    // Source chain details
    pub source_chain: String,
    pub source_token: String,
    pub source_amount: u128,
    pub source_address: String,
    
    // Destination chain details
    pub dest_chain: String,
    pub dest_token: String,
    pub dest_amount: u128,
    pub dest_address: String,
    
    // Security parameters
    pub hashlock: String,
    pub timelock: u64, // Unix timestamp in seconds
    
    // Metadata
    pub created_at: u64,
    pub updated_at: u64,
    
    // Additional metadata for the solver
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<HashMap<String, String>>,
}

impl CrossChainOrder {
    /// Creates a new cross-chain order
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
    ) -> Self {
        let now = near_sdk::env::block_timestamp() / 1_000_000; // Convert to seconds
        
        Self {
            id,
            status: OrderStatus::Created,
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
            created_at: now,
            updated_at: now,
            metadata: None,
        }
    }

    /// Updates the order status
    pub fn update_status(&mut self, status: OrderStatus) {
        self.status = status;
        self.updated_at = near_sdk::env::block_timestamp() / 1_000_000;
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

    /// Checks if the order is still valid (not expired)
    pub fn is_valid(&self) -> bool {
        let now = near_sdk::env::block_timestamp() / 1_000_000; // Convert to seconds
        now <= self.timelock
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::test_env;

    #[test]
    fn test_order_creation() {
        // Setup test environment
        test_env::setup();
        
        // Create a new order
        let order = CrossChainOrder::new(
            "test-order-1".to_string(),
            "ethereum".to_string(),
            "0xTokenAddress".to_string(),
            1000000000000000000u128, // 1 ETH
            "0xUserAddress".to_string(),
            "near".to_string(),
            "wrap.near".to_string(),
            1000000000000000000000u128, // 1000 wNEAR
            "user.near".to_string(),
            "0x1234abcd".to_string(),
            1735689600, // Jan 1, 2025
        );

        // Verify order properties
        assert_eq!(order.status, OrderStatus::Created);
        assert_eq!(order.source_chain, "ethereum");
        assert_eq!(order.dest_chain, "near");
        assert!(order.is_valid());
        
        // Test status update
        let mut order = order;
        order.update_status(OrderStatus::Processing);
        assert_eq!(order.status, OrderStatus::Processing);
        
        // Test metadata
        order.add_metadata("tx_hash".to_string(), "0x1234".to_string());
        assert!(order.metadata.is_some());
        assert_eq!(
            order.metadata.unwrap().get("tx_hash").unwrap(),
            "0x1234"
        );
    }
}
