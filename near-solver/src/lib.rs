use near_sdk::{
    borsh::{self, BorshDeserialize, BorshSerialize},
    collections::UnorderedMap,
    env, log, near_bindgen, require,
    AccountId, PanicOnDefault, Promise,
};
use std::collections::HashMap;

// Import our modules
pub mod event;
pub mod model;
pub mod service;
pub mod tee;
pub mod utils;

// Test utilities module - only available in test mode
#[cfg(test)]
mod test_utils;

// Re-export test_utils for integration tests
#[cfg(test)]
pub use test_utils::*;

// Make test_utils available for integration tests
#[cfg(test)]
pub mod test_utils_export {
    pub use super::test_utils::*;
}

use crate::{
    event::ContractEvent,
    model::order::{CrossChainOrder, OrderStatus},
    service::solver::{OneInchNearSolver, SolverConfig, TokenConfig},
    tee::{TeeAttestation, TeeType},
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
            tee_attestation: None,
            paused: false,
        }
    }

    /// Process a new cross-chain order
    #[payable]
    pub fn process_order(&mut self, order: CrossChainOrder) -> Promise {
        self.assert_not_paused();
        self.assert_authorized();
        
        // Verify TEE attestation if required
        if let Some(attestation) = &self.tee_attestation {
            let current_timestamp = env::block_timestamp() / 1_000_000_000; // Convert to seconds
            require!(
                attestation.is_valid(current_timestamp),
                "TEE attestation is required and must be valid"
            );
        }
        
        // Store the order
        self.orders.insert(&order.id, &order);
        
        // Emit order created event
        emit_event!(ContractEvent::new_order_created(
            order.id.clone(),
            order.source_chain.clone(),
            order.dest_chain.clone(),
            order.source_token.clone(),
            order.dest_token.clone(),
            order.amount
        ));
        
        log!("Processing order: {}", order.id);
        
        // Process the order asynchronously
        Promise::new(env::current_account_id())
            .function_call(
                "process_order_callback".to_string(),
                near_sdk::serde_json::to_vec(&order).expect("Failed to serialize order"),
                near_sdk::NearToken::from_yoctonear(0),
                near_sdk::Gas::from_tgas(50), // 50 TGas for callback
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
                let _old_status = order.status_to_string(&order.status);
                
                order.update_status(OrderStatus::Cancelled);
                self.orders.insert(&order_id, &order);
                
                // Emit order cancelled event
                emit_event!(ContractEvent::OrderCancelled {
                    order_id: order_id.clone(),
                    reason: reason.clone().unwrap_or_else(|| "User requested cancellation".to_string()),
                    timestamp: crate::utils::env_block_timestamp_seconds(),
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
    
    // ========== Partial Fill Methods ==========
    
    /// Process a partial fill for an existing order
    #[payable]
    pub fn process_partial_fill(
        &mut self,
        order_id: String,
        fill_amount: u128,
        executor: String,
        tx_hash: Option<String>
    ) {
        self.assert_not_paused();
        self.assert_authorized();
        
        if let Some(mut order) = self.orders.get(&order_id) {
            match order.process_partial_fill(fill_amount, executor.clone(), tx_hash.clone()) {
                Ok(fill_event) => {
                    self.orders.insert(&order_id, &order);
                    
                    // Emit fill event
                    emit_event!(ContractEvent::OrderFilled {
                        order_id: order_id.clone(),
                        filled_amount: fill_amount,
                        executor,
                        fill_percentage: order.get_fill_percentage() as u64,
                        timestamp: crate::utils::env_block_timestamp_seconds(),
                    });
                    
                    log!("Processed partial fill: {:?}", fill_event);
                }
                Err(e) => {
                    env::panic_str(&format!("Failed to process partial fill: {}", e));
                }
            }
        } else {
            env::panic_str("Order not found");
        }
    }
    
    /// Split an order into smaller orders
    #[payable]
    pub fn split_order(&mut self, order_id: String, split_amounts: Vec<u128>) -> Vec<String> {
        self.assert_not_paused();
        self.assert_authorized();
        
        if let Some(mut parent_order) = self.orders.get(&order_id) {
            match parent_order.split_order(split_amounts) {
                Ok(child_orders) => {
                    let mut child_ids = Vec::new();
                    
                    // Store child orders
                    for child_order in child_orders {
                        child_ids.push(child_order.id.clone());
                        self.orders.insert(&child_order.id, &child_order);
                        
                        // Emit child order created event
                        emit_event!(ContractEvent::OrderCreated {
                            order_id: child_order.id.clone(),
                            source_chain: child_order.source_chain.clone(),
                            dest_chain: child_order.dest_chain.clone(),
                            source_token: child_order.source_token.clone(),
                            dest_token: child_order.dest_token.clone(),
                            amount: child_order.amount,
                            timestamp: crate::utils::env_block_timestamp_seconds(),
                        });
                    }
                    
                    // Update parent order
                    parent_order.child_order_ids = child_ids.clone();
                    parent_order.update_status(OrderStatus::Processing);
                    self.orders.insert(&order_id, &parent_order);
                    
                    log!("Split order {} into {} child orders", order_id, child_ids.len());
                    
                    child_ids
                }
                Err(e) => {
                    env::panic_str(&format!("Failed to split order: {}", e));
                }
            }
        } else {
            env::panic_str("Order not found");
        }
    }
    
    /// Process refunds for expired orders with unfilled portions
    pub fn process_refunds(&mut self) -> Vec<String> {
        self.assert_not_paused();
        self.assert_authorized();
        
        let mut refunded_orders = Vec::new();
        let order_ids: Vec<String> = self.orders.keys().collect();
        
        for order_id in order_ids {
            if let Some(mut order) = self.orders.get(&order_id) {
                if order.needs_refund() {
                    let refund_amount = order.calculate_refund_amount();
                    
                    if refund_amount > 0 {
                        // Update order status
                        order.update_status(OrderStatus::Failed("Expired with partial refund".to_string()));
                        order.add_metadata("refund_amount".to_string(), refund_amount.to_string());
                        order.add_metadata("refund_processed".to_string(), "true".to_string());
                        
                        self.orders.insert(&order_id, &order);
                        
                        // Emit refund event
                        emit_event!(ContractEvent::OrderRefunded {
                            order_id: order_id.clone(),
                            refund_amount,
                            reason: "Order expired with unfilled portion".to_string(),
                            timestamp: crate::utils::env_block_timestamp_seconds(),
                        });
                        
                        refunded_orders.push(order_id);
                        
                        log!("Processed refund for order {}: {} tokens", order_id, refund_amount);
                    }
                }
            }
        }
        
        refunded_orders
    }
    
    /// Get detailed order information including fill history
    pub fn get_order_details(&self, order_id: String) -> Option<CrossChainOrder> {
        self.orders.get(&order_id)
    }
    
    /// Get fill history for an order
    pub fn get_fill_history(&self, order_id: String) -> Vec<crate::model::order::FillEvent> {
        if let Some(order) = self.orders.get(&order_id) {
            order.fill_history.clone()
        } else {
            Vec::new()
        }
    }
    
    /// Get child orders for a split order
    pub fn get_child_orders(&self, parent_order_id: String) -> Vec<CrossChainOrder> {
        if let Some(parent_order) = self.orders.get(&parent_order_id) {
            let mut child_orders = Vec::new();
            for child_id in &parent_order.child_order_ids {
                if let Some(child_order) = self.orders.get(child_id) {
                    child_orders.push(child_order);
                }
            }
            child_orders
        } else {
            Vec::new()
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
        
        // Store the string representation for the event
        let tee_type_str = tee_type.clone();
        
        // Convert string tee_type to TeeType enum
        let tee_type_enum = match tee_type.as_str() {
            "SGX" => TeeType::Sgx,
            "SEV" => TeeType::Sev,
            "TrustZone" => TeeType::TrustZone,
            "AwsNitro" => TeeType::AwsNitro,
            "AzureAttestation" => TeeType::AzureAttestation,
            "Asylo" => TeeType::Asylo,
            other => TeeType::Other(other.to_string()),
        };
        
        let current_timestamp = env::block_timestamp() / 1_000_000_000; // Convert to seconds
        let _expires_at = current_timestamp + expires_in_seconds;
        
        let attestation = TeeAttestation::new(
            tee_type_enum,
            public_key,
            report,
            signature,
            env::signer_account_id(),
            expires_in_seconds,
            Some(HashMap::new())
        );
        
        match attestation {
            Ok(att) => {
                self.tee_attestation = Some(att.clone());
                
                // Emit TEE attestation verified event
                emit_event!(ContractEvent::TeeAttestationVerified {
                    tee_type: tee_type_str,
                    status: "Verified".to_string(),
                    timestamp: crate::utils::env_block_timestamp_seconds(),
                });
            },
            Err(err) => {
                // Emit error event
                ContractEvent::emit_error(
                    None,
                    format!("TEE attestation validation failed: {:?}", err),
                    None
                );
                env::panic_str("TEE attestation validation failed");
            }
        }
        
        log!("TEE attestation updated");
    }
    
    /// Remove the TEE attestation
    pub fn remove_tee_attestation(&mut self) {
        self.assert_owner();
        
        if let Some(attestation) = &self.tee_attestation {
            emit_event!(ContractEvent::TeeAttestationVerified {
                tee_type: attestation.tee_type.to_string(),
                status: "Removed".to_string(),
                timestamp: crate::utils::env_block_timestamp_seconds(),
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
        if env::signer_account_id() != self.owner_id {
            env::panic_str("Only the owner can call this method");
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
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    
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
            "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE".to_string(),
            1000000000000000000u128, // 1 ETH
            "0xSourceAddress".to_string(),
            "near".to_string(),
            "wrap.near".to_string(),
            1000000000000000000u128, // 1 wNEAR
            "alice.near".to_string(),
            "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef".to_string(), // hashlock
            1735689600, // timelock - Jan 1, 2025
        ).expect("Failed to create test order")
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
        // Set up the test context
        let mut context = VMContextBuilder::new();
        context
            .current_account_id(accounts(0))
            .signer_account_id(accounts(1))
            .predecessor_account_id(accounts(1));
        
        // Initialize the testing environment with the context
        testing_env!(context.build());
        
        // Create contract and test order
        let mut contract = CrossChainSolverContract::new(accounts(1));
        let order = create_test_order();
        
        // Process the order - this will store the order and return a Promise
        contract.process_order(order.clone());
        
        // Manually call the callback to simulate the async execution
        // In a real scenario, this would be called by the Promise
        contract.process_order_callback(order.clone());
        
        // Verify the order status was updated to Filled
        let stored_order = contract.get_order_status(order.id).unwrap();
        assert_eq!(stored_order.status, OrderStatus::Filled);
    }
    
    #[test]
    #[should_panic(expected = "Only the owner can call this method")]
    fn test_unauthorized_access() {
        // First, set up the context for contract initialization
        let mut init_context = VMContextBuilder::new();
        init_context
            .current_account_id(accounts(0))
            .signer_account_id(accounts(1))
            .predecessor_account_id(accounts(1));
        
        // Initialize the testing environment with the initial context
        testing_env!(init_context.build());
        
        // Initialize the contract with owner as accounts(1)
        let mut contract = CrossChainSolverContract::new(accounts(1));
        let order = create_test_order();
        
        // Set up a new context with a different predecessor (non-owner)
        let mut unauthorized_context = VMContextBuilder::new();
        unauthorized_context
            .current_account_id(accounts(0))
            .signer_account_id(accounts(2))
            .predecessor_account_id(accounts(2));
        
        // Update the testing environment with the unauthorized context
        testing_env!(unauthorized_context.build());
        
        // This should panic with unauthorized access
        contract.process_order(order);
    }
}
