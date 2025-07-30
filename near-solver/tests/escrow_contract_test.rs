use serde::{Deserialize, Serialize};
use serde_json;
use std::collections::HashMap;
use sha2::{Digest, Sha256};

// Simplified structures for testing the escrow contract logic
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum OrderStatus {
    Pending,
    Filled,
    Cancelled,
    Expired,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Order {
    pub id: String,
    pub status: OrderStatus,
    pub created_at: u64,
    pub expires_at: u64,
    pub maker: String,
    pub taker: Option<String>,
    pub token_in: String,
    pub token_out: String,
    pub amount_in: u128,
    pub amount_out: u128,
    pub fee: u128,
    pub hashlock: String,
    pub timelock: u64,
    pub tee_public_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeeAttestation {
    pub public_key: String,
    pub owner_id: String,
    pub created_at: u64,
    pub expires_at: u64,
    pub revoked_at: Option<u64>,
    pub metadata: String,
    pub signature: String,
}

// Simplified escrow contract for testing
pub struct EscrowContract {
    pub owner_id: String,
    pub tee_registry_id: String,
    pub chain_sig_enabled: bool,
    pub protocol_fee_basis_points: u16,
    pub orders: HashMap<String, Order>,
    pub order_ids: Vec<String>,
    pub maker_orders: HashMap<String, Vec<String>>,
    pub taker_orders: HashMap<String, Vec<String>>,
    pub order_nonce: u64,
}

impl EscrowContract {
    pub fn new(owner_id: String, tee_registry_id: String) -> Self {
        Self {
            owner_id,
            tee_registry_id,
            chain_sig_enabled: false,
            protocol_fee_basis_points: 10, // 0.1% default fee
            orders: HashMap::new(),
            order_ids: Vec::new(),
            maker_orders: HashMap::new(),
            taker_orders: HashMap::new(),
            order_nonce: 0,
        }
    }

    // Admin functions
    pub fn update_tee_registry(&mut self, tee_registry_id: String, caller: &str) -> Result<(), String> {
        if caller != self.owner_id {
            return Err("Only owner can update TEE registry".to_string());
        }
        self.tee_registry_id = tee_registry_id;
        Ok(())
    }

    pub fn update_protocol_fee(&mut self, basis_points: u16, caller: &str) -> Result<(), String> {
        if caller != self.owner_id {
            return Err("Only owner can update protocol fee".to_string());
        }
        if basis_points > 1000 {
            return Err("Protocol fee cannot exceed 10%".to_string());
        }
        self.protocol_fee_basis_points = basis_points;
        Ok(())
    }

    pub fn set_chain_sig_enabled(&mut self, enabled: bool, caller: &str) -> Result<(), String> {
        if caller != self.owner_id {
            return Err("Only owner can enable/disable chain signatures".to_string());
        }
        self.chain_sig_enabled = enabled;
        Ok(())
    }

    pub fn is_chain_sig_enabled(&self) -> bool {
        self.chain_sig_enabled
    }

    // Public functions
    pub fn create_order(
        &mut self,
        token_in: String,
        token_out: String,
        amount_in: u128,
        amount_out: u128,
        expires_in_sec: u64,
        hashlock: String,
        timelock: u64,
        tee_public_key: String,
        caller: &str,
    ) -> Result<String, String> {
        // Validate inputs
        if amount_in == 0 {
            return Err("Amount in must be greater than 0".to_string());
        }
        if amount_out == 0 {
            return Err("Amount out must be greater than 0".to_string());
        }
        if expires_in_sec == 0 {
            return Err("Expiration time must be greater than 0".to_string());
        }
        if hashlock.is_empty() {
            return Err("Hashlock cannot be empty".to_string());
        }
        if tee_public_key.is_empty() {
            return Err("TEE public key cannot be empty".to_string());
        }

        // Verify TEE attestation (simplified)
        if !self.verify_tee_attestation(&tee_public_key) {
            return Err("Invalid TEE attestation".to_string());
        }

        // Generate order ID
        let order_id = self.generate_order_id();

        // Calculate fee
        let fee = (amount_in * self.protocol_fee_basis_points as u128) / 10000;

        let current_time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        let order = Order {
            id: order_id.clone(),
            status: OrderStatus::Pending,
            created_at: current_time,
            expires_at: current_time + expires_in_sec,
            maker: caller.to_string(),
            taker: None,
            token_in,
            token_out,
            amount_in,
            amount_out,
            fee,
            hashlock,
            timelock,
            tee_public_key,
        };

        // Store order
        self.orders.insert(order_id.clone(), order);
        self.order_ids.push(order_id.clone());
        self.add_to_maker_orders(caller, &order_id);

        Ok(order_id)
    }

    pub fn fill_order(&mut self, order_id: String, preimage: String, caller: &str) -> Result<(), String> {
        let order = self.orders.get_mut(&order_id)
            .ok_or("Order not found")?;

        if order.status != OrderStatus::Pending {
            return Err("Order is not pending".to_string());
        }

        let current_time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        if current_time > order.expires_at {
            return Err("Order has expired".to_string());
        }

        if current_time > order.timelock {
            return Err("Order timelock has expired".to_string());
        }

        // Verify preimage matches hashlock
        if !self.verify_hashlock(&order.hashlock, &preimage) {
            return Err("Invalid preimage".to_string());
        }

        // Fill the order
        order.status = OrderStatus::Filled;
        order.taker = Some(caller.to_string());
        self.add_to_taker_orders(caller, &order_id);

        Ok(())
    }

    pub fn cancel_order(&mut self, order_id: String, caller: &str) -> Result<(), String> {
        let order = self.orders.get_mut(&order_id)
            .ok_or("Order not found")?;

        if order.maker != caller {
            return Err("Only order maker can cancel".to_string());
        }

        if order.status != OrderStatus::Pending {
            return Err("Order is not pending".to_string());
        }

        order.status = OrderStatus::Cancelled;
        Ok(())
    }

    // View functions
    pub fn get_order(&self, order_id: String) -> Option<&Order> {
        self.orders.get(&order_id)
    }

    pub fn get_order_ids(&self, from_index: usize, limit: usize) -> Vec<String> {
        let end_index = std::cmp::min(from_index + limit, self.order_ids.len());
        if from_index >= self.order_ids.len() {
            return Vec::new();
        }
        self.order_ids[from_index..end_index].to_vec()
    }

    pub fn get_orders_by_maker(&self, maker: &str, from_index: usize, limit: usize) -> Vec<&Order> {
        if let Some(order_ids) = self.maker_orders.get(maker) {
            let end_index = std::cmp::min(from_index + limit, order_ids.len());
            if from_index >= order_ids.len() {
                return Vec::new();
            }
            order_ids[from_index..end_index]
                .iter()
                .filter_map(|id| self.orders.get(id))
                .collect()
        } else {
            Vec::new()
        }
    }

    // Internal functions
    fn verify_tee_attestation(&self, public_key: &str) -> bool {
        // Simplified TEE attestation verification for testing
        !public_key.is_empty() && public_key.len() > 10
    }

    fn verify_hashlock(&self, hashlock: &str, preimage: &str) -> bool {
        // Simplified hashlock verification
        let mut hasher = Sha256::new();
        hasher.update(preimage.as_bytes());
        let hash = hasher.finalize();
        let computed_hash = hex::encode(hash);
        
        // Remove 0x prefix if present
        let hashlock_clean = if hashlock.starts_with("0x") {
            &hashlock[2..]
        } else {
            hashlock
        };
        
        computed_hash == hashlock_clean
    }

    fn generate_order_id(&mut self) -> String {
        self.order_nonce += 1;
        format!("order_{}", self.order_nonce)
    }

    fn add_to_maker_orders(&mut self, maker: &str, order_id: &str) {
        self.maker_orders
            .entry(maker.to_string())
            .or_insert_with(Vec::new)
            .push(order_id.to_string());
    }

    fn add_to_taker_orders(&mut self, taker: &str, order_id: &str) {
        self.taker_orders
            .entry(taker.to_string())
            .or_insert_with(Vec::new)
            .push(order_id.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_contract() -> EscrowContract {
        EscrowContract::new(
            "owner.near".to_string(),
            "tee_registry.near".to_string(),
        )
    }

    #[test]
    fn test_contract_initialization() {
        let contract = setup_contract();
        assert_eq!(contract.owner_id, "owner.near");
        assert_eq!(contract.tee_registry_id, "tee_registry.near");
        assert!(!contract.chain_sig_enabled);
        assert_eq!(contract.protocol_fee_basis_points, 10);
        assert_eq!(contract.order_nonce, 0);
    }

    #[test]
    fn test_admin_functions() {
        let mut contract = setup_contract();

        // Test TEE registry update
        assert!(contract.update_tee_registry("new_registry.near".to_string(), "owner.near").is_ok());
        assert_eq!(contract.tee_registry_id, "new_registry.near");

        // Test unauthorized TEE registry update
        assert!(contract.update_tee_registry("malicious.near".to_string(), "attacker.near").is_err());

        // Test protocol fee update
        assert!(contract.update_protocol_fee(50, "owner.near").is_ok());
        assert_eq!(contract.protocol_fee_basis_points, 50);

        // Test invalid protocol fee
        assert!(contract.update_protocol_fee(1500, "owner.near").is_err()); // > 10%

        // Test unauthorized protocol fee update
        assert!(contract.update_protocol_fee(25, "attacker.near").is_err());

        // Test chain signature enable/disable
        assert!(contract.set_chain_sig_enabled(true, "owner.near").is_ok());
        assert!(contract.is_chain_sig_enabled());

        assert!(contract.set_chain_sig_enabled(false, "owner.near").is_ok());
        assert!(!contract.is_chain_sig_enabled());

        // Test unauthorized chain sig update
        assert!(contract.set_chain_sig_enabled(true, "attacker.near").is_err());
    }

    #[test]
    fn test_create_order() {
        let mut contract = setup_contract();

        let order_id = contract.create_order(
            "wrap.near".to_string(),
            "0x1234...".to_string(),
            1_000_000_000_000_000_000_000, // 1000 NEAR
            1_000_000_000_000_000_000, // 1 ETH
            3600, // 1 hour
            "0xabcdef1234567890".to_string(),
            86400, // 24 hours
            "ed25519:valid_tee_key".to_string(),
            "alice.near",
        ).unwrap();

        assert_eq!(order_id, "order_1");
        assert_eq!(contract.order_nonce, 1);

        let order = contract.get_order(order_id.clone()).unwrap();
        assert_eq!(order.id, order_id);
        assert_eq!(order.status, OrderStatus::Pending);
        assert_eq!(order.maker, "alice.near");
        assert_eq!(order.taker, None);
        assert_eq!(order.amount_in, 1_000_000_000_000_000_000_000);
        assert_eq!(order.amount_out, 1_000_000_000_000_000_000);
        assert_eq!(order.fee, 1_000_000_000_000_000_000); // 0.1% of amount_in
    }

    #[test]
    fn test_create_order_validation() {
        let mut contract = setup_contract();

        // Test zero amount_in
        assert!(contract.create_order(
            "wrap.near".to_string(),
            "0x1234...".to_string(),
            0, // Zero amount
            1_000_000_000_000_000_000,
            3600,
            "0xabcdef1234567890".to_string(),
            86400,
            "ed25519:valid_tee_key".to_string(),
            "alice.near",
        ).is_err());

        // Test zero amount_out
        assert!(contract.create_order(
            "wrap.near".to_string(),
            "0x1234...".to_string(),
            1_000_000_000_000_000_000_000,
            0, // Zero amount
            3600,
            "0xabcdef1234567890".to_string(),
            86400,
            "ed25519:valid_tee_key".to_string(),
            "alice.near",
        ).is_err());

        // Test zero expiration
        assert!(contract.create_order(
            "wrap.near".to_string(),
            "0x1234...".to_string(),
            1_000_000_000_000_000_000_000,
            1_000_000_000_000_000_000,
            0, // Zero expiration
            "0xabcdef1234567890".to_string(),
            86400,
            "ed25519:valid_tee_key".to_string(),
            "alice.near",
        ).is_err());

        // Test empty hashlock
        assert!(contract.create_order(
            "wrap.near".to_string(),
            "0x1234...".to_string(),
            1_000_000_000_000_000_000_000,
            1_000_000_000_000_000_000,
            3600,
            "".to_string(), // Empty hashlock
            86400,
            "ed25519:valid_tee_key".to_string(),
            "alice.near",
        ).is_err());

        // Test empty TEE public key
        assert!(contract.create_order(
            "wrap.near".to_string(),
            "0x1234...".to_string(),
            1_000_000_000_000_000_000_000,
            1_000_000_000_000_000_000,
            3600,
            "0xabcdef1234567890".to_string(),
            86400,
            "".to_string(), // Empty TEE key
            "alice.near",
        ).is_err());
    }

    #[test]
    fn test_fill_order() {
        let mut contract = setup_contract();

        // Create an order first
        let hashlock = "0xabcdef1234567890";
        let preimage = "secret";
        
        // Calculate the correct hashlock for the preimage
        let mut hasher = Sha256::new();
        hasher.update(preimage.as_bytes());
        let hash = hasher.finalize();
        let computed_hashlock = format!("0x{}", hex::encode(hash));

        let order_id = contract.create_order(
            "wrap.near".to_string(),
            "0x1234...".to_string(),
            1_000_000_000_000_000_000_000,
            1_000_000_000_000_000_000,
            3600,
            computed_hashlock,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs() + 86400, // 24 hours from now
            "ed25519:valid_tee_key".to_string(),
            "alice.near",
        ).unwrap();

        // Fill the order
        assert!(contract.fill_order(order_id.clone(), preimage.to_string(), "bob.near").is_ok());

        let order = contract.get_order(order_id).unwrap();
        assert_eq!(order.status, OrderStatus::Filled);
        assert_eq!(order.taker, Some("bob.near".to_string()));
    }

    #[test]
    fn test_fill_order_failures() {
        let mut contract = setup_contract();

        let order_id = contract.create_order(
            "wrap.near".to_string(),
            "0x1234...".to_string(),
            1_000_000_000_000_000_000_000,
            1_000_000_000_000_000_000,
            3600,
            "0xabcdef1234567890".to_string(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs() + 86400,
            "ed25519:valid_tee_key".to_string(),
            "alice.near",
        ).unwrap();

        // Test fill with wrong preimage
        assert!(contract.fill_order(order_id.clone(), "wrong_secret".to_string(), "bob.near").is_err());

        // Test fill non-existent order
        assert!(contract.fill_order("non_existent".to_string(), "secret".to_string(), "bob.near").is_err());
    }

    #[test]
    fn test_cancel_order() {
        let mut contract = setup_contract();

        let order_id = contract.create_order(
            "wrap.near".to_string(),
            "0x1234...".to_string(),
            1_000_000_000_000_000_000_000,
            1_000_000_000_000_000_000,
            3600,
            "0xabcdef1234567890".to_string(),
            86400,
            "ed25519:valid_tee_key".to_string(),
            "alice.near",
        ).unwrap();

        // Cancel the order
        assert!(contract.cancel_order(order_id.clone(), "alice.near").is_ok());

        let order = contract.get_order(order_id).unwrap();
        assert_eq!(order.status, OrderStatus::Cancelled);
    }

    #[test]
    fn test_cancel_order_unauthorized() {
        let mut contract = setup_contract();

        let order_id = contract.create_order(
            "wrap.near".to_string(),
            "0x1234...".to_string(),
            1_000_000_000_000_000_000_000,
            1_000_000_000_000_000_000,
            3600,
            "0xabcdef1234567890".to_string(),
            86400,
            "ed25519:valid_tee_key".to_string(),
            "alice.near",
        ).unwrap();

        // Try to cancel as different user
        assert!(contract.cancel_order(order_id, "bob.near").is_err());
    }

    #[test]
    fn test_get_orders_by_maker() {
        let mut contract = setup_contract();

        // Create multiple orders for the same maker
        for i in 0..3 {
            contract.create_order(
                "wrap.near".to_string(),
                format!("0x123{}...", i),
                1_000_000_000_000_000_000_000 + (i as u128 * 100_000_000_000_000_000_000),
                1_000_000_000_000_000_000,
                3600,
                format!("0xabcdef123456789{}", i),
                86400,
                "ed25519:valid_tee_key".to_string(),
                "alice.near",
            ).unwrap();
        }

        let orders = contract.get_orders_by_maker("alice.near", 0, 10);
        assert_eq!(orders.len(), 3);

        // Test pagination
        let first_page = contract.get_orders_by_maker("alice.near", 0, 2);
        assert_eq!(first_page.len(), 2);

        let second_page = contract.get_orders_by_maker("alice.near", 2, 2);
        assert_eq!(second_page.len(), 1);

        // Test non-existent maker
        let no_orders = contract.get_orders_by_maker("nonexistent.near", 0, 10);
        assert_eq!(no_orders.len(), 0);
    }

    #[test]
    fn test_hashlock_verification() {
        let contract = setup_contract();
        let preimage = "test_secret";
        
        let mut hasher = Sha256::new();
        hasher.update(preimage.as_bytes());
        let hash = hasher.finalize();
        let hashlock = hex::encode(hash);
        
        assert!(contract.verify_hashlock(&hashlock, preimage));
        assert!(contract.verify_hashlock(&format!("0x{}", hashlock), preimage));
        assert!(!contract.verify_hashlock(&hashlock, "wrong_preimage"));
    }

    #[test]
    fn test_order_id_generation() {
        let mut contract = setup_contract();
        
        let id1 = contract.generate_order_id();
        let id2 = contract.generate_order_id();
        let id3 = contract.generate_order_id();
        
        assert_eq!(id1, "order_1");
        assert_eq!(id2, "order_2");
        assert_eq!(id3, "order_3");
        assert_eq!(contract.order_nonce, 3);
    }
}
