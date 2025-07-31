use serde::{Deserialize, Serialize};
use serde_json;
use std::collections::HashMap;

// Simplified version of the order model for testing
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum OrderStatus {
    Pending,
    Processing,
    Filled,
    Cancelled,
    Expired,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrossChainOrder {
    pub id: String,
    pub status: OrderStatus,
    pub maker: String,
    pub taker: Option<String>,
    pub token_in: String,
    pub token_out: String,
    pub amount_in: u128,
    pub amount_out: u128,
    pub chain_in: String,
    pub chain_out: String,
    pub expires_at: u64,
    pub created_at: u64,
    pub hashlock: Option<String>,
    pub timelock: Option<u64>,
    pub metadata: HashMap<String, String>,
}

impl CrossChainOrder {
    pub fn new(
        id: String,
        maker: String,
        token_in: String,
        token_out: String,
        amount_in: u128,
        amount_out: u128,
        chain_in: String,
        chain_out: String,
        expires_at: u64,
    ) -> Self {
        Self {
            id,
            status: OrderStatus::Pending,
            maker,
            taker: None,
            token_in,
            token_out,
            amount_in,
            amount_out,
            chain_in,
            chain_out,
            expires_at,
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
            hashlock: None,
            timelock: None,
            metadata: HashMap::new(),
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.id.is_empty() {
            return Err("Order ID cannot be empty".to_string());
        }
        if self.maker.is_empty() {
            return Err("Maker cannot be empty".to_string());
        }
        if self.amount_in == 0 {
            return Err("Amount in must be greater than 0".to_string());
        }
        if self.amount_out == 0 {
            return Err("Amount out must be greater than 0".to_string());
        }
        if self.expires_at <= self.created_at {
            return Err("Expiration must be in the future".to_string());
        }
        Ok(())
    }

    pub fn set_hashlock(&mut self, hashlock: String) {
        self.hashlock = Some(hashlock);
    }

    pub fn set_timelock(&mut self, timelock: u64) {
        self.timelock = Some(timelock);
    }

    pub fn fill(&mut self, taker: String) -> Result<(), String> {
        if self.status != OrderStatus::Pending {
            return Err("Order is not pending".to_string());
        }
        self.status = OrderStatus::Filled;
        self.taker = Some(taker);
        Ok(())
    }

    pub fn cancel(&mut self) -> Result<(), String> {
        if self.status != OrderStatus::Pending {
            return Err("Order is not pending".to_string());
        }
        self.status = OrderStatus::Cancelled;
        Ok(())
    }

    pub fn is_expired(&self, current_time: u64) -> bool {
        current_time > self.expires_at
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_order_creation() {
        let order = CrossChainOrder::new(
            "order_1".to_string(),
            "alice.near".to_string(),
            "wrap.near".to_string(),
            "0xA0b86a33E6441e8e421c7D7240c7F8b4A9C0C8b1".to_string(),
            1_000_000_000_000_000_000_000, // 1000 NEAR
            1_000_000_000_000_000_000, // 1 ETH
            "near".to_string(),
            "ethereum".to_string(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs() + 3600, // 1 hour from now
        );

        assert_eq!(order.id, "order_1");
        assert_eq!(order.status, OrderStatus::Pending);
        assert_eq!(order.maker, "alice.near");
        assert_eq!(order.taker, None);
        assert_eq!(order.amount_in, 1_000_000_000_000_000_000_000);
        assert_eq!(order.amount_out, 1_000_000_000_000_000_000);
    }

    #[test]
    fn test_order_validation() {
        let mut order = CrossChainOrder::new(
            "order_1".to_string(),
            "alice.near".to_string(),
            "wrap.near".to_string(),
            "0xA0b86a33E6441e8e421c7D7240c7F8b4A9C0C8b1".to_string(),
            1_000_000_000_000_000_000_000,
            1_000_000_000_000_000_000,
            "near".to_string(),
            "ethereum".to_string(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs() + 3600,
        );

        // Valid order should pass validation
        assert!(order.validate().is_ok());

        // Test empty ID
        order.id = "".to_string();
        assert!(order.validate().is_err());
        order.id = "order_1".to_string();

        // Test empty maker
        order.maker = "".to_string();
        assert!(order.validate().is_err());
        order.maker = "alice.near".to_string();

        // Test zero amount_in
        order.amount_in = 0;
        assert!(order.validate().is_err());
        order.amount_in = 1_000_000_000_000_000_000_000;

        // Test zero amount_out
        order.amount_out = 0;
        assert!(order.validate().is_err());
        order.amount_out = 1_000_000_000_000_000_000;

        // Test expired order
        order.expires_at = order.created_at - 1;
        assert!(order.validate().is_err());
    }

    #[test]
    fn test_order_hashlock_timelock() {
        let mut order = CrossChainOrder::new(
            "order_1".to_string(),
            "alice.near".to_string(),
            "wrap.near".to_string(),
            "0xA0b86a33E6441e8e421c7D7240c7F8b4A9C0C8b1".to_string(),
            1_000_000_000_000_000_000_000,
            1_000_000_000_000_000_000,
            "near".to_string(),
            "ethereum".to_string(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs() + 3600,
        );

        // Initially no hashlock or timelock
        assert_eq!(order.hashlock, None);
        assert_eq!(order.timelock, None);

        // Set hashlock
        let hashlock = "0x1234567890abcdef".to_string();
        order.set_hashlock(hashlock.clone());
        assert_eq!(order.hashlock, Some(hashlock));

        // Set timelock
        let timelock = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() + 86400; // 24 hours
        order.set_timelock(timelock);
        assert_eq!(order.timelock, Some(timelock));
    }

    #[test]
    fn test_order_fill() {
        let mut order = CrossChainOrder::new(
            "order_1".to_string(),
            "alice.near".to_string(),
            "wrap.near".to_string(),
            "0xA0b86a33E6441e8e421c7D7240c7F8b4A9C0C8b1".to_string(),
            1_000_000_000_000_000_000_000,
            1_000_000_000_000_000_000,
            "near".to_string(),
            "ethereum".to_string(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs() + 3600,
        );

        // Fill order
        let taker = "bob.near".to_string();
        assert!(order.fill(taker.clone()).is_ok());
        assert_eq!(order.status, OrderStatus::Filled);
        assert_eq!(order.taker, Some(taker));

        // Cannot fill already filled order
        assert!(order.fill("charlie.near".to_string()).is_err());
    }

    #[test]
    fn test_order_cancel() {
        let mut order = CrossChainOrder::new(
            "order_1".to_string(),
            "alice.near".to_string(),
            "wrap.near".to_string(),
            "0xA0b86a33E6441e8e421c7D7240c7F8b4A9C0C8b1".to_string(),
            1_000_000_000_000_000_000_000,
            1_000_000_000_000_000_000,
            "near".to_string(),
            "ethereum".to_string(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs() + 3600,
        );

        // Cancel order
        assert!(order.cancel().is_ok());
        assert_eq!(order.status, OrderStatus::Cancelled);

        // Cannot cancel already cancelled order
        assert!(order.cancel().is_err());
    }

    #[test]
    fn test_order_expiration() {
        let current_time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        let order = CrossChainOrder::new(
            "order_1".to_string(),
            "alice.near".to_string(),
            "wrap.near".to_string(),
            "0xA0b86a33E6441e8e421c7D7240c7F8b4A9C0C8b1".to_string(),
            1_000_000_000_000_000_000_000,
            1_000_000_000_000_000_000,
            "near".to_string(),
            "ethereum".to_string(),
            current_time + 3600, // 1 hour from now
        );

        // Order should not be expired now
        assert!(!order.is_expired(current_time));

        // Order should be expired in the future
        assert!(order.is_expired(current_time + 7200)); // 2 hours from now
    }

    #[test]
    fn test_order_serialization() {
        let order = CrossChainOrder::new(
            "order_1".to_string(),
            "alice.near".to_string(),
            "wrap.near".to_string(),
            "0xA0b86a33E6441e8e421c7D7240c7F8b4A9C0C8b1".to_string(),
            1_000_000_000_000_000_000_000,
            1_000_000_000_000_000_000,
            "near".to_string(),
            "ethereum".to_string(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs() + 3600,
        );

        // Test JSON serialization
        let json = serde_json::to_string(&order).unwrap();
        assert!(!json.is_empty());

        // Test JSON deserialization
        let deserialized: CrossChainOrder = serde_json::from_str(&json).unwrap();
        assert_eq!(order.id, deserialized.id);
        assert_eq!(order.maker, deserialized.maker);
        assert_eq!(order.amount_in, deserialized.amount_in);
        assert_eq!(order.amount_out, deserialized.amount_out);
    }
}
