use near_sdk::{
    borsh::{self, BorshDeserialize, BorshSerialize},
    env, near_bindgen, require,
    serde::{Deserialize, Serialize},
    AccountId, Promise,
};

use crate::{
    error::ContractError,
    event::ContractEvent,
    model::order::Order,
    tee::{TeeAttestation, TeeRegistry},
    Contract, ContractExt,
};

/// Shade Agent contract that integrates with TEE registry for secure order processing
#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize)]
pub struct ShadeAgent {
    /// The TEE registry contract account ID
    tee_registry_account: AccountId,
    /// The admin account that can update the TEE registry reference
    admin_id: AccountId,
}

#[near_bindgen]
impl ShadeAgent {
    /// Initialize a new Shade Agent contract
    #[init]
    pub fn new(tee_registry_account: AccountId, admin_id: AccountId) -> Self {
        Self {
            tee_registry_account,
            admin_id,
        }
    }

    /// Update the TEE registry account (admin only)
    #[payable]
    pub fn update_tee_registry(&mut self, new_registry: AccountId) {
        self.assert_admin();
        self.tee_registry_account = new_registry;
    }

    /// Process an order with TEE attestation verification
    #[payable]
    pub fn process_order(
        &mut self,
        order: Order,
        tee_public_key: String,
        tee_attestation: TeeAttestation,
    ) -> Result<(), ContractError> {
        // Verify the TEE attestation is valid and registered
        self.verify_tee_attestation(&tee_public_key, &tee_attestation)?;

        // Process the order (implementation depends on your specific order processing logic)
        self.execute_order(order, &tee_public_key)
    }

    // ===== Internal Methods =====

    /// Verify the TEE attestation is valid and registered
    fn verify_tee_attestation(
        &self,
        public_key: &str,
        attestation: &TeeAttestation,
    ) -> Result<(), ContractError> {
        // Verify the attestation signature and format
        attestation.verify()?;

        // Cross-verify with the TEE registry
        let registry = TeeRegistry::new(self.tee_registry_account.clone());
        
        // Check if the attestation is registered and valid
        if !registry.is_attestation_valid(public_key.to_string()) {
            return Err(ContractError::InvalidTeeAttestation(
                "TEE attestation is not registered or has been revoked".to_string(),
            ));
        }

        Ok(())
    }

    /// Execute the order (placeholder implementation)
    fn execute_order(&mut self, order: Order, tee_public_key: &str) -> Result<(), ContractError> {
        // Emit event for order processing start
        if let Ok(event) = ContractEvent::new_order_processing_started(
            &order.id,
            tee_public_key,
        ) {
            event.emit();
        }

        // TODO: Implement actual order execution logic
        // This would include:
        // 1. Validating the order
        // 2. Checking signatures
        // 3. Executing the swap
        // 4. Updating order status

        // Emit event for order processing completion
        if let Ok(event) = ContractEvent::new_order_processing_completed(
            &order.id,
            "completed",
        ) {
            event.emit();
        }

        Ok(())
    }

    /// Assert that the caller is the admin
    fn assert_admin(&self) {
        require!(
            env::predecessor_account_id() == self.admin_id,
            "Only admin can call this method"
        );
    }
}

// Implement the Contract trait for ShadeAgent
impl Contract for ShadeAgent {
    fn assert_owner(&self) {
        self.assert_admin();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::{test_utils::VMContextBuilder, testing_env, VMContext};
    use crate::model::order::{Order, OrderStatus};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn get_context(is_view: bool) -> VMContext {
        VMContextBuilder::new()
            .current_account_id("shade_agent.testnet".parse().unwrap())
            .signer_account_id("bob.testnet".parse().unwrap())
            .predecessor_account_id("bob.testnet".parse().unwrap())
            .is_view(is_view)
            .build()
    }

    fn create_test_order() -> Order {
        Order {
            id: "test_order_1".to_string(),
            status: OrderStatus::Pending,
            created_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs(),
            // Add other required order fields
            ..Default::default()
        }
    }

    #[test]
    fn test_process_order_with_valid_tee() {
        let context = get_context(false);
        testing_env!(context);

        // Setup test environment
        let tee_registry_account = "tee_registry.testnet".parse().unwrap();
        let admin_id = "admin.testnet".parse().unwrap();
        
        let mut agent = ShadeAgent::new(tee_registry_account.clone(), admin_id);
        
        // Create test order and TEE attestation
        let order = create_test_order();
        let public_key = "test_public_key".to_string();
        
        // This is a simplified test - in a real test, we would mock the TEE registry
        // and provide a properly signed attestation
        let attestation = TeeAttestation {
            public_key: public_key.clone(),
            tee_type: crate::tee::TeeType::Sgx,
            owner_id: "owner.testnet".parse().unwrap(),
            metadata: r#"{"enclave_quote":"test_quote"}"#.to_string(),
            signature: "test_signature".to_string(),
            created_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs(),
            expires_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs()
                + 3600, // 1 hour from now
            revoked_at: None,
        };

        // Process the order
        let result = agent.process_order(order, public_key, attestation);
        
        // Verify the result
        assert!(result.is_ok());
    }

    // Add more test cases for error conditions and edge cases
}
