use crate::model::order::{CrossChainOrder, OrderStatus};
use anyhow::Result;
use async_trait::async_trait;
use near_sdk::{
    json_types::{Base64VecU8, U128},
    serde_json::json,
    AccountId, Promise,
};
use serde::{Deserialize, Serialize};
use sha3::{Digest, Keccak256};
use std::collections::HashMap;

/// Trait defining the core solver functionality
#[async_trait]
pub trait CrossChainSolver: Send + Sync {
    /// Process a new cross-chain order
    async fn process_order(&mut self, order: CrossChainOrder) -> Result<()>;
    
    /// Get the current status of an order
    async fn get_order_status(&self, order_id: &str) -> Result<Option<CrossChainOrder>>;
    
    /// Cancel an order
    async fn cancel_order(&mut self, order_id: &str) -> Result<()>;
    
    /// Verify the secret for a hashlock
    fn verify_secret(&self, hashlock: &str, secret: &[u8]) -> bool {
        let mut hasher = Keccak256::new();
        hasher.update(secret);
        let hash = hasher.finalize();
        hex::encode(hash) == hashlock
    }
}

/// Implementation of the cross-chain solver
pub struct OneInchNearSolver {
    /// NEAR account ID of the solver
    pub account_id: AccountId,
    /// Storage for active orders
    pub orders: HashMap<String, CrossChainOrder>,
    /// Configuration for the solver
    pub config: SolverConfig,
}

/// Configuration for the solver
#[derive(Clone, Serialize, Deserialize)]
pub struct SolverConfig {
    /// Minimum time (in seconds) for order expiration
    pub min_expiration: u64,
    /// Maximum time (in seconds) for order expiration
    pub max_expiration: u64,
    /// Default gas for order execution
    pub default_gas: u64,
    /// Supported tokens and their configurations
    pub supported_tokens: HashMap<String, TokenConfig>,
}

/// Configuration for a supported token
#[derive(Clone, Serialize, Deserialize)]
pub struct TokenConfig {
    /// Minimum amount that can be swapped
    pub min_amount: u128,
    /// Maximum amount that can be swapped
    pub max_amount: u128,
    /// Fee basis points (e.g., 30 = 0.3%)
    pub fee_bps: u16,
    /// Whether the token is currently enabled
    pub enabled: bool,
}

impl OneInchNearSolver {
    /// Create a new solver instance
    pub fn new(account_id: AccountId, config: SolverConfig) -> Self {
        Self {
            account_id,
            orders: HashMap::new(),
            config,
        }
    }

    /// Generate a 1inch Fusion+ compatible meta-order
    pub async fn generate_meta_order(&self, order: &CrossChainOrder) -> Result<serde_json::Value> {
        // Verify the order is valid before processing
        if !order.is_valid() {
            anyhow::bail!("Order has expired");
        }

        // Create the meta-order structure compatible with 1inch Fusion+
        let meta_order = json!({
            "makerAsset": order.source_token,
            "takerAsset": order.dest_token,
            "makingAmount": order.source_amount.to_string(),
            "takingAmount": order.dest_amount.to_string(),
            "maker": order.source_address,
            "receiver": order.dest_address,
            "allowedSender": self.account_id.to_string(),
            "getMakingAmount": "0x0",  // Will be filled by the solver
            "getTakingAmount": "0x0",  // Will be filled by the solver
            "predicate": order.hashlock,
            "permit": "0x",  // Will be filled with permit data if needed
            "interaction": "0x",  // Will be filled with custom interaction if needed
        });

        Ok(meta_order)
    }

    /// Process a new cross-chain order
    pub async fn process_order_impl(&mut self, mut order: CrossChainOrder) -> Result<()> {
        // Update order status to processing
        order.update_status(OrderStatus::Processing);
        self.orders.insert(order.id.clone(), order.clone());

        // Generate the meta-order
        let meta_order = self.generate_meta_order(&order).await?;

        // TODO: Submit the meta-order to 1inch Fusion+ API
        // For now, we'll just log it
        log::info!("Generated meta-order: {}", meta_order);

        // Update order status
        if let Some(stored_order) = self.orders.get_mut(&order.id) {
            stored_order.update_status(OrderStatus::Filled);
            stored_order.add_metadata("meta_order".to_string(), meta_order.to_string());
        }

        Ok(())
    }

    /// Get the current status of an order
    pub fn get_order_status_impl(&self, order_id: &str) -> Result<Option<CrossChainOrder>> {
        Ok(self.orders.get(order_id).cloned())
    }

    /// Cancel an order
    pub fn cancel_order_impl(&mut self, order_id: &str) -> Result<()> {
        if let Some(order) = self.orders.get_mut(order_id) {
            if order.status == OrderStatus::Created || order.status == OrderStatus::Processing {
                order.update_status(OrderStatus::Cancelled);
                Ok(())
            } else {
                anyhow::bail!("Cannot cancel order in current state: {:?}", order.status)
            }
        } else {
            anyhow::bail!("Order not found")
        }
    }
}

#[async_trait]
impl CrossChainSolver for OneInchNearSolver {
    async fn process_order(&mut self, order: CrossChainOrder) -> Result<()> {
        self.process_order_impl(order).await
    }

    async fn get_order_status(&self, order_id: &str) -> Result<Option<CrossChainOrder>> {
        self.get_order_status_impl(order_id)
    }

    async fn cancel_order(&mut self, order_id: &str) -> Result<()> {
        self.cancel_order_impl(order_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::test_env;
    use std::str::FromStr;

    fn create_test_order() -> CrossChainOrder {
        CrossChainOrder::new(
            "test-order-1".to_string(),
            "ethereum".to_string(),
            "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE".to_string(), // ETH
            1000000000000000000u128, // 1 ETH
            "0x1234567890123456789012345678901234567890".to_string(),
            "near".to_string(),
            "wrap.near".to_string(),
            1000000000000000000000u128, // 1000 wNEAR
            "user.near".to_string(),
            "0x1234abcd".to_string(),
            1735689600, // Jan 1, 2025
        )
    }

    fn create_test_config() -> SolverConfig {
        let mut supported_tokens = HashMap::new();
        supported_tokens.insert(
            "wrap.near".to_string(),
            TokenConfig {
                min_amount: 1000000000000000000, // 1 wNEAR
                max_amount: 1000000000000000000000000, // 1M wNEAR
                fee_bps: 30, // 0.3%
                enabled: true,
            },
        );

        SolverConfig {
            min_expiration: 300, // 5 minutes
            max_expiration: 86400, // 1 day
            default_gas: 100000000000000, // 100 TGas
            supported_tokens,
        }
    }

    #[tokio::test]
    async fn test_process_order() {
        // Setup test environment
        test_env::setup();
        
        let account_id = AccountId::from_str("solver.near").unwrap();
        let config = create_test_config();
        let mut solver = OneInchNearSolver::new(account_id, config);
        
        let order = create_test_order();
        
        // Test order processing
        let result = solver.process_order(order.clone()).await;
        assert!(result.is_ok());
        
        // Verify order status was updated
        let status = solver.get_order_status(&order.id).await.unwrap();
        assert!(status.is_some());
        assert_eq!(status.unwrap().status, OrderStatus::Filled);
    }
    
    #[tokio::test]
    async fn test_cancel_order() {
        // Setup test environment
        test_env::setup();
        
        let account_id = AccountId::from_str("solver.near").unwrap();
        let config = create_test_config();
        let mut solver = OneInchNearSolver::new(account_id, config);
        
        let order = create_test_order();
        
        // Manually add order to simulate it being in progress
        solver.orders.insert(order.id.clone(), order.clone());
        
        // Test order cancellation
        let result = solver.cancel_order(&order.id).await;
        assert!(result.is_ok());
        
        // Verify order status was updated to cancelled
        let status = solver.get_order_status(&order.id).await.unwrap();
        assert_eq!(status.unwrap().status, OrderStatus::Cancelled);
    }
}
