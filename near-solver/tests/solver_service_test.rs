use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use async_trait::async_trait;

// Simplified structures for testing the solver service logic
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrossChainOrder {
    pub id: String,
    pub maker: String,
    pub token_in: String,
    pub token_out: String,
    pub amount_in: u128,
    pub amount_out: u128,
    pub chain_in: String,
    pub chain_out: String,
    pub expires_at: u64,
    pub metadata: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OneInchMetaOrder {
    pub order_id: String,
    pub maker: String,
    pub taker: String,
    pub maker_asset: String,
    pub taker_asset: String,
    pub making_amount: String,
    pub taking_amount: String,
    pub salt: String,
    pub deadline: u64,
    pub signature: String,
    pub interactions: Vec<String>,
}

#[derive(Debug)]
pub enum SolverError {
    InvalidOrder,
    InsufficientLiquidity,
    NetworkError,
    SignatureError,
    ValidationError(String),
}

// Trait for cross-chain solver
#[async_trait]
pub trait CrossChainSolver {
    async fn process_order(&self, order: CrossChainOrder) -> Result<String, SolverError>;
    async fn generate_meta_order(&self, order: &CrossChainOrder) -> Result<OneInchMetaOrder, SolverError>;
    async fn sign_transaction(&self, data: &[u8]) -> Result<String, SolverError>;
    fn validate_order(&self, order: &CrossChainOrder) -> Result<(), SolverError>;
}

// Implementation of the NEAR solver
pub struct OneInchNearSolver {
    pub chain_id: String,
    pub supported_tokens: HashMap<String, bool>,
    pub max_order_amount: u128,
    pub min_order_amount: u128,
}

impl OneInchNearSolver {
    pub fn new(chain_id: String) -> Self {
        let mut supported_tokens = HashMap::new();
        supported_tokens.insert("wrap.near".to_string(), true);
        supported_tokens.insert("usdt.near".to_string(), true);
        supported_tokens.insert("usdc.near".to_string(), true);

        Self {
            chain_id,
            supported_tokens,
            max_order_amount: 1_000_000_000_000_000_000_000_000, // 1M tokens
            min_order_amount: 1_000_000_000_000_000_000, // 1 token
        }
    }

    fn generate_salt(&self) -> String {
        use std::time::{SystemTime, UNIX_EPOCH};
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        format!("0x{:x}", timestamp)
    }

    fn calculate_deadline(&self, expires_at: u64) -> u64 {
        // Use the order's expiration time, but ensure it's reasonable
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        if expires_at > now {
            expires_at
        } else {
            now + 3600 // Default to 1 hour if expired
        }
    }
}

#[async_trait]
impl CrossChainSolver for OneInchNearSolver {
    async fn process_order(&self, order: CrossChainOrder) -> Result<String, SolverError> {
        // Validate the order first
        self.validate_order(&order)?;

        // Generate meta-order
        let meta_order = self.generate_meta_order(&order).await?;

        // In a real implementation, this would submit to the network
        // For testing, we just return the order ID
        Ok(meta_order.order_id)
    }

    async fn generate_meta_order(&self, order: &CrossChainOrder) -> Result<OneInchMetaOrder, SolverError> {
        // Validate order before processing
        self.validate_order(order)?;

        let salt = self.generate_salt();
        let deadline = self.calculate_deadline(order.expires_at);

        // Create the meta-order structure compatible with 1inch Fusion+
        let meta_order = OneInchMetaOrder {
            order_id: order.id.clone(),
            maker: order.maker.clone(),
            taker: "0x0000000000000000000000000000000000000000".to_string(), // Zero address for open orders
            maker_asset: self.convert_near_to_eth_address(&order.token_in)?,
            taker_asset: order.token_out.clone(),
            making_amount: order.amount_in.to_string(),
            taking_amount: order.amount_out.to_string(),
            salt,
            deadline,
            signature: "".to_string(), // Will be filled by signing process
            interactions: vec![], // Simplified for testing
        };

        Ok(meta_order)
    }

    async fn sign_transaction(&self, data: &[u8]) -> Result<String, SolverError> {
        // Simplified signing for testing
        // In real implementation, this would use NEAR Chain Signatures
        if data.is_empty() {
            return Err(SolverError::SignatureError);
        }

        // Mock signature generation
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(data);
        hasher.update(self.chain_id.as_bytes());
        let hash = hasher.finalize();
        
        Ok(format!("0x{}", hex::encode(hash)))
    }

    fn validate_order(&self, order: &CrossChainOrder) -> Result<(), SolverError> {
        // Check if order ID is valid
        if order.id.is_empty() {
            return Err(SolverError::ValidationError("Order ID cannot be empty".to_string()));
        }

        // Check if maker is valid
        if order.maker.is_empty() {
            return Err(SolverError::ValidationError("Maker cannot be empty".to_string()));
        }

        // Check token support
        if !self.supported_tokens.get(&order.token_in).unwrap_or(&false) {
            return Err(SolverError::ValidationError(format!("Token {} not supported", order.token_in)));
        }

        // Check amount bounds
        if order.amount_in < self.min_order_amount {
            return Err(SolverError::ValidationError("Amount too small".to_string()));
        }

        if order.amount_in > self.max_order_amount {
            return Err(SolverError::ValidationError("Amount too large".to_string()));
        }

        if order.amount_out == 0 {
            return Err(SolverError::ValidationError("Output amount must be greater than 0".to_string()));
        }

        // Check expiration
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        if order.expires_at <= now {
            return Err(SolverError::ValidationError("Order has expired".to_string()));
        }

        // Check chain compatibility
        if order.chain_in != "near" {
            return Err(SolverError::ValidationError("Only NEAR input chain supported".to_string()));
        }

        if order.chain_out != "ethereum" {
            return Err(SolverError::ValidationError("Only Ethereum output chain supported".to_string()));
        }

        Ok(())
    }
}

impl OneInchNearSolver {
    fn convert_near_to_eth_address(&self, near_token: &str) -> Result<String, SolverError> {
        // Simplified mapping for testing
        match near_token {
            "wrap.near" => Ok("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2".to_string()), // WETH
            "usdt.near" => Ok("0xdAC17F958D2ee523a2206206994597C13D831ec7".to_string()), // USDT
            "usdc.near" => Ok("0xA0b86a33E6441e8e421c7D7240c7F8b4A9C0C8b1".to_string()), // USDC
            _ => Err(SolverError::ValidationError(format!("Unknown NEAR token: {}", near_token))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio;

    fn create_test_order() -> CrossChainOrder {
        CrossChainOrder {
            id: "test_order_1".to_string(),
            maker: "alice.near".to_string(),
            token_in: "wrap.near".to_string(),
            token_out: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2".to_string(),
            amount_in: 1_000_000_000_000_000_000_000, // 1000 NEAR
            amount_out: 1_000_000_000_000_000_000, // 1 ETH
            chain_in: "near".to_string(),
            chain_out: "ethereum".to_string(),
            expires_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs() + 3600, // 1 hour from now
            metadata: HashMap::new(),
        }
    }

    #[test]
    fn test_solver_creation() {
        let solver = OneInchNearSolver::new("near-testnet".to_string());
        assert_eq!(solver.chain_id, "near-testnet");
        assert!(solver.supported_tokens.contains_key("wrap.near"));
        assert!(solver.supported_tokens.contains_key("usdt.near"));
        assert!(solver.supported_tokens.contains_key("usdc.near"));
    }

    #[test]
    fn test_order_validation_success() {
        let solver = OneInchNearSolver::new("near-testnet".to_string());
        let order = create_test_order();
        
        assert!(solver.validate_order(&order).is_ok());
    }

    #[test]
    fn test_order_validation_failures() {
        let solver = OneInchNearSolver::new("near-testnet".to_string());
        
        // Test empty order ID
        let mut order = create_test_order();
        order.id = "".to_string();
        assert!(solver.validate_order(&order).is_err());
        
        // Test empty maker
        let mut order = create_test_order();
        order.maker = "".to_string();
        assert!(solver.validate_order(&order).is_err());
        
        // Test unsupported token
        let mut order = create_test_order();
        order.token_in = "unsupported.near".to_string();
        assert!(solver.validate_order(&order).is_err());
        
        // Test amount too small
        let mut order = create_test_order();
        order.amount_in = 100; // Much smaller than min
        assert!(solver.validate_order(&order).is_err());
        
        // Test amount too large
        let mut order = create_test_order();
        order.amount_in = 10_000_000_000_000_000_000_000_000; // Larger than max
        assert!(solver.validate_order(&order).is_err());
        
        // Test zero output amount
        let mut order = create_test_order();
        order.amount_out = 0;
        assert!(solver.validate_order(&order).is_err());
        
        // Test expired order
        let mut order = create_test_order();
        order.expires_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() - 3600; // 1 hour ago
        assert!(solver.validate_order(&order).is_err());
        
        // Test wrong input chain
        let mut order = create_test_order();
        order.chain_in = "ethereum".to_string();
        assert!(solver.validate_order(&order).is_err());
        
        // Test wrong output chain
        let mut order = create_test_order();
        order.chain_out = "polygon".to_string();
        assert!(solver.validate_order(&order).is_err());
    }

    #[tokio::test]
    async fn test_generate_meta_order() {
        let solver = OneInchNearSolver::new("near-testnet".to_string());
        let order = create_test_order();
        
        let meta_order = solver.generate_meta_order(&order).await.unwrap();
        
        assert_eq!(meta_order.order_id, order.id);
        assert_eq!(meta_order.maker, order.maker);
        assert_eq!(meta_order.taker, "0x0000000000000000000000000000000000000000");
        assert_eq!(meta_order.maker_asset, "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"); // WETH
        assert_eq!(meta_order.taker_asset, order.token_out);
        assert_eq!(meta_order.making_amount, order.amount_in.to_string());
        assert_eq!(meta_order.taking_amount, order.amount_out.to_string());
        assert!(!meta_order.salt.is_empty());
        assert!(meta_order.deadline > order.expires_at - 100); // Should be close to expires_at
    }

    #[tokio::test]
    async fn test_process_order() {
        let solver = OneInchNearSolver::new("near-testnet".to_string());
        let order = create_test_order();
        
        let result = solver.process_order(order.clone()).await.unwrap();
        assert_eq!(result, order.id);
    }

    #[tokio::test]
    async fn test_sign_transaction() {
        let solver = OneInchNearSolver::new("near-testnet".to_string());
        let data = b"test transaction data";
        
        let signature = solver.sign_transaction(data).await.unwrap();
        assert!(signature.starts_with("0x"));
        assert_eq!(signature.len(), 66); // 0x + 64 hex chars
        
        // Test with empty data should fail
        let result = solver.sign_transaction(&[]).await;
        assert!(result.is_err());
    }

    #[test]
    fn test_token_address_conversion() {
        let solver = OneInchNearSolver::new("near-testnet".to_string());
        
        assert_eq!(
            solver.convert_near_to_eth_address("wrap.near").unwrap(),
            "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
        );
        
        assert_eq!(
            solver.convert_near_to_eth_address("usdt.near").unwrap(),
            "0xdAC17F958D2ee523a2206206994597C13D831ec7"
        );
        
        assert_eq!(
            solver.convert_near_to_eth_address("usdc.near").unwrap(),
            "0xA0b86a33E6441e8e421c7D7240c7F8b4A9C0C8b1"
        );
        
        // Test unknown token
        assert!(solver.convert_near_to_eth_address("unknown.near").is_err());
    }

    #[test]
    fn test_salt_generation() {
        let solver = OneInchNearSolver::new("near-testnet".to_string());
        
        // Generate multiple salts to ensure they're different
        let mut salts = std::collections::HashSet::new();
        let count = 10;
        
        for _ in 0..count {
            let salt = solver.generate_salt();
            assert!(salt.starts_with("0x"), "Salt should start with 0x");
            assert_eq!(salt.len() > 2, true, "Salt should have content after 0x");
            salts.insert(salt);
            
            // Ensure we have enough entropy by sleeping briefly
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
        
        // All salts should be unique
        assert_eq!(salts.len(), count, "All generated salts should be unique");
    }

    #[test]
    fn test_deadline_calculation() {
        let solver = OneInchNearSolver::new("near-testnet".to_string());
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        // Test future expiration
        let future_expires = now + 7200; // 2 hours
        let deadline = solver.calculate_deadline(future_expires);
        assert_eq!(deadline, future_expires);
        
        // Test past expiration (should default to 1 hour from now)
        let past_expires = now - 3600; // 1 hour ago
        let deadline = solver.calculate_deadline(past_expires);
        assert!(deadline > now);
        assert!(deadline <= now + 3600);
    }
}
