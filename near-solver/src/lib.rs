use near_sdk::{
    borsh::{self, BorshDeserialize, BorshSerialize},
    collections::UnorderedMap,
    env, log, near_bindgen, require,
    serde::{Deserialize, Serialize},
    AccountId, Balance, PanicOnDefault, Promise, PromiseResult,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// Import our modules
pub mod event;
pub mod model;
pub mod service;
pub mod tee;
pub mod utils;

use crate::{
    event::ContractEvent,
    model::order::{CrossChainOrder, OrderStatus},
    service::solver::{OneInchNearSolver, SolverConfig, TokenConfig},
    tee::TeeAttestation,
};

// Define the contract structure
#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize, PanicOnDefault)]
pub struct CrossChainSolverContract {
    /// Owner of the contract (usually the DAO or admin)
    owner_id: AccountId,
    /// Active solver instance
    solver: OneInchNearSolver,
    /// Storage for orders
    orders: UnorderedMap<String, CrossChainOrder>,
    /// Configuration for the solver
    config: SolverConfig,
    /// TEE attestation if enabled
    tee_attestation: Option<TeeAttestation>,
    /// Is the contract paused
    paused: bool,
}

// Implement the contract's core functionality
#[near_bindgen]
impl CrossChainSolverContract {
    /// Initialize the contract with default configuration
    #[init]
    pub fn new(owner_id: AccountId) -> Self {
        assert!(!env::state_exists(), "Already initialized");
        
        // Default configuration
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

        let config = SolverConfig {
            min_expiration: 300, // 5 minutes
            max_expiration: 86400, // 1 day
            default_gas: 100_000_000_000_000, // 100 TGas
            supported_tokens,
        };

        let solver = OneInchNearSolver::new(env::current_account_id(), config.clone());

        Self {
            owner_id,
            solver,
            orders: UnorderedMap::new(b"o".to_vec()),
            config,
        }
    }

    /// Process a new cross-chain order
    #[payable]
    pub fn process_order(&mut self, order: CrossChainOrder) -> Promise {
        self.assert_not_paused();
        self.assert_authorized();
        
        // Verify TEE attestation if required
        if let Some(attestation) = &self.tee_attestation {
            require!(
                attestation.is_valid(),
                "TEE attestation is required and must be valid"
            );
        }
        
        // Store the order
        self.orders.insert(&order.id, &order);
        
        // Emit order created event
        emit_event!(ContractEvent::OrderCreated {
            order_id: order.id.clone(),
            source_chain: order.source_chain.clone(),
            dest_chain: order.dest_chain.clone(),
            source_token: order.source_token.clone(),
            dest_token: order.dest_token.clone(),
            amount: order.source_amount,
        });
        
        log!("Processing order: {}", order.id);
        
        // Process the order asynchronously
        Promise::new(env::current_account_id())
            .function_call(
                b"process_order_callback".to_vec(),
                near_sdk::serde_json::to_vec(&order).expect("Failed to serialize order"),
                0,
                env::prepaid_gas() - env::used_gas() - 10_000_000_000_000, // Leave some gas for callback
            )
    }
    
    /// Callback after processing an order
    #[private]
    pub fn process_order_callback(&mut self, order: CrossChainOrder) {
        // This would contain the actual order processing logic
        // For now, we'll just update the status
        if let Some(mut stored_order) = self.orders.get(&order.id) {
            stored_order.update_status(OrderStatus::Filled);
            self.orders.insert(&order.id, &stored_order);
        }
    }
    
    /// Get the status of an order
    pub fn get_order_status(&self, order_id: String) -> Option<CrossChainOrder> {
        self.orders.get(&order_id)
    }
    
    /// Cancel an order
    pub fn cancel_order(&mut self, order_id: String, reason: Option<String>) {
        self.assert_authorized();
        
        if let Some(mut order) = self.orders.get(&order_id) {
            if order.status != OrderStatus::Filled && order.status != OrderStatus::Cancelled {
                let old_status = order.status_to_string(&order.status);
                
                order.update_status(OrderStatus::Cancelled);
                self.orders.insert(&order_id, &order);
                
                // Emit order cancelled event
                emit_event!(ContractEvent::OrderCancelled {
                    order_id: order_id.clone(),
                    reason: reason.unwrap_or_else(|| "User requested cancellation".to_string()),
                });
                
                log!(
                    "Order {} cancelled. Reason: {}",
                    order_id,
                    reason.as_deref().unwrap_or("No reason provided")
                );
            } else {
                env::panic_str("Cannot cancel order in current state");
            }
        } else {
            env::panic_str("Order not found");
        }
    }
    
    // ========== TEE Attestation Methods ========== //
    
    /// Set or update the TEE attestation
    pub fn set_tee_attestation(
        &mut self,
        tee_type: String,
        public_key: String,
        report: String,
        signature: String,
        expires_in_seconds: u64,
    ) {
        self.assert_owner();
        
        let attestation = TeeAttestation::new(
            tee_type,
            public_key,
            report,
            signature,
            expires_in_seconds,
        );
        
        self.tee_attestation = Some(attestation.clone());
        
        // Emit TEE attestation verified event
        emit_event!(ContractEvent::TeeAttestationVerified {
            tee_type: attestation.tee_type,
            status: "Verified".to_string(),
        });
        
        log!("TEE attestation updated");
    }
    
    /// Remove the TEE attestation
    pub fn remove_tee_attestation(&mut self) {
        self.assert_owner();
        
        if let Some(attestation) = &self.tee_attestation {
            emit_event!(ContractEvent::TeeAttestationVerified {
                tee_type: attestation.tee_type.clone(),
                status: "Removed".to_string(),
            });
            
            self.tee_attestation = None;
            log!("TEE attestation removed");
        }
    }
    
    // ========== Admin Methods ========== //
    
    /// Pause the contract (only owner)
    pub fn pause(&mut self) {
        self.assert_owner();
        self.paused = true;
        log!("Contract paused");
    }
    
    /// Unpause the contract (only owner)
    pub fn unpause(&mut self) {
        self.assert_owner();
        self.paused = false;
        log!("Contract unpaused");
    }
    
    // ========== Helper Methods ========== //
    
    /// Verify the contract is not paused
    fn assert_not_paused(&self) {
        require!(!self.paused, "Contract is paused");
    }
    
    /// Verify the caller is authorized to call this method
    fn assert_authorized(&self) {
        // In a real implementation, this would check if the caller is authorized
        // For now, we'll just check that the method is not called directly
        if env::current_account_id() == env::signer_account_id() {
            env::panic_str("Method cannot be called directly");
        }
    }
    
    /// Verify the caller is the contract owner
    fn assert_owner(&self) {
        if env::signer_account_id() != self.owner_id {
            env::panic_str("Only contract owner can call this method");
        }
    }
}

// Tests
#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::{testing_env, Balance};
    use std::str::FromStr;
    
    // Helper function to set up the testing environment
    fn get_context() -> VMContextBuilder {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id(accounts(0))
            .signer_account_id(accounts(1))
            .predecessor_account_id(accounts(1));
        builder
    }
    
    // Helper function to create a test order
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
    
    #[test]
    fn test_initialization() {
        let context = get_context();
        testing_env!(context.build());
        
        let contract = CrossChainSolverContract::new(accounts(1));
        assert_eq!(contract.owner_id, accounts(1));
    }
    
    #[test]
    fn test_process_order() {
        let mut context = get_context();
        testing_env!(context.build());
        
        let mut contract = CrossChainSolverContract::new(accounts(1));
        let order = create_test_order();
        
        // Set the predecessor to the owner
        testing_env!(context.predecessor_account_id(accounts(1)).build());
        
        // Process the order
        contract.process_order(order.clone());
        
        // Verify the order was stored
        let stored_order = contract.get_order_status(order.id).unwrap();
        assert_eq!(stored_order.status, OrderStatus::Filled);
    }
    
    #[test]
    #[should_panic(expected = "Only the owner can call this method")]
    fn test_unauthorized_access() {
        let context = get_context();
        testing_env!(context.build());
        
        let mut contract = CrossChainSolverContract::new(accounts(1));
        let order = create_test_order();
        
        // Set the predecessor to a non-owner account
        testing_env!(context.predecessor_account_id(accounts(2)).build());
        
        // This should panic with unauthorized access
        contract.process_order(order);
    }
}
