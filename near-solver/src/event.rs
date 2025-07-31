//! Event emission and handling for the cross-chain resolver
//!
//! This module defines the event system for the cross-chain resolver contract.
//! Events are emitted for important state changes and can be used by off-chain
//! services to track the status of cross-chain swaps.

use near_sdk::{
    env,
    serde::{Deserialize, Serialize},
    serde_json,
    AccountId, PromiseResult,
};
use crate::model::order::OrderStatus;

/// Helper function to get block timestamp in seconds
fn env_block_timestamp_seconds() -> u64 {
    env::block_timestamp() / 1_000_000_000 // Convert nanoseconds to seconds
}

/// Represents an event emitted by the contract
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(crate = "near_sdk::serde", tag = "event_type")]
pub enum ContractEvent {
    /// Order created event
    #[serde(rename = "ORDER_CREATED")]
    OrderCreated {
        order_id: String,
        source_chain: String,
        dest_chain: String,
        source_token: String,
        dest_token: String,
        amount: u128,
        #[serde(default = "env_block_timestamp_seconds")]
        timestamp: u64,
    },
    
    /// Order status changed event
    #[serde(rename = "ORDER_STATUS_CHANGED")]
    OrderStatusChanged {
        order_id: String,
        old_status: OrderStatus,
        new_status: OrderStatus,
        #[serde(default = "env_block_timestamp_seconds")]
        timestamp: u64,
    },
    
    /// Funds locked event
    #[serde(rename = "FUNDS_LOCKED")]
    FundsLocked {
        order_id: String,
        token: String,
        amount: u128,
        sender: AccountId,
        #[serde(default = "env_block_timestamp_seconds")]
        timestamp: u64,
    },
    
    /// Funds released event
    #[serde(rename = "FUNDS_RELEASED")]
    FundsReleased {
        order_id: String,
        token: String,
        amount: u128,
        recipient: AccountId,
        #[serde(default = "env_block_timestamp_seconds")]
        timestamp: u64,
    },
    
    /// Error event
    #[serde(rename = "ERROR")]
    Error {
        order_id: Option<String>,
        message: String,
        details: Option<String>,
        #[serde(default = "env_block_timestamp_seconds")]
        timestamp: u64,
    },
    
    /// TEE Attestation verified event
    #[serde(rename = "TEE_ATTESTATION_VERIFIED")]
    TeeAttestationVerified {
        tee_type: String,
        status: String,
        #[serde(default = "env_block_timestamp_seconds")]
        timestamp: u64,
    },
    
    /// TEE Attestation registered event
    #[serde(rename = "TEE_ATTESTATION_REGISTERED")]
    TeeAttestationRegistered {
        public_key: String,
        tee_type: String,
        #[serde(default = "env_block_timestamp_seconds")]
        timestamp: u64,
    },
    
    /// TEE Attestation revoked event
    #[serde(rename = "TEE_ATTESTATION_REVOKED")]
    TeeAttestationRevoked {
        public_key: String,
        reason: String,
        #[serde(default = "env_block_timestamp_seconds")]
        timestamp: u64,
    },
    
    /// TEE Attestation extended event
    #[serde(rename = "TEE_ATTESTATION_EXTENDED")]
    TeeAttestationExtended {
        public_key: String,
        new_expires_at: u64,
        #[serde(default = "env_block_timestamp_seconds")]
        timestamp: u64,
    },
    
    /// TEE Attestation updated event
    #[serde(rename = "TEE_ATTESTATION_UPDATED")]
    TeeAttestationUpdated {
        public_key: String,
        field: String,
        #[serde(default = "env_block_timestamp_seconds")]
        timestamp: u64,
    },
    
    /// Order cancelled event
    #[serde(rename = "ORDER_CANCELLED")]
    OrderCancelled {
        order_id: String,
        reason: String,
        #[serde(default = "env_block_timestamp_seconds")]
        timestamp: u64,
    },
}

impl ContractEvent {
    /// Creates a new order created event
    pub fn new_order_created(
        order_id: String,
        source_chain: String,
        dest_chain: String,
        source_token: String,
        dest_token: String,
        amount: u128,
    ) -> Self {
        Self::OrderCreated {
            order_id,
            source_chain,
            dest_chain,
            source_token,
            dest_token,
            amount,
            timestamp: env_block_timestamp_seconds(),
        }
    }
    
    /// Creates a new error event
    pub fn new_error(
        order_id: Option<String>,
        message: impl Into<String>,
        details: Option<String>,
    ) -> Self {
        Self::Error {
            order_id,
            message: message.into(),
            details,
            timestamp: env_block_timestamp_seconds(),
        }
    }

    /// Emits the event to the blockchain
    pub fn emit(&self) {
        if let Ok(json) = serde_json::to_string(self) {
            env::log_str(&json);
        }
    }
    
    /// Emits an error event
    pub fn emit_error(order_id: Option<String>, message: impl Into<String>, details: Option<String>) {
        Self::new_error(order_id, message, details).emit();
    }
    
    /// Emits an error event for a failed promise result
    pub fn emit_promise_error(order_id: Option<String>, result: &PromiseResult, context: &str) {
        match result {
            PromiseResult::Failed => {
                Self::emit_error(
                    order_id,
                    format!("Promise failed: {}", context),
                    None,
                );
            }
            PromiseResult::Successful(_) => {
                // No error to emit for successful promise
            }
        }
    }
    
    /// Creates a new TEE attestation registered event
    pub fn new_tee_attestation_registered(public_key: String, tee_type: String) -> Self {
        Self::TeeAttestationRegistered {
            public_key,
            tee_type,
            timestamp: env_block_timestamp_seconds(),
        }
    }
    
    /// Creates a new TEE attestation revoked event
    pub fn new_tee_attestation_revoked(public_key: String, reason: String) -> Self {
        Self::TeeAttestationRevoked {
            public_key,
            reason,
            timestamp: env_block_timestamp_seconds(),
        }
    }
    
    /// Creates a new TEE attestation extended event
    pub fn new_tee_attestation_extended(public_key: String, new_expires_at: u64) -> Self {
        Self::TeeAttestationExtended {
            public_key,
            new_expires_at,
            timestamp: env_block_timestamp_seconds(),
        }
    }
    
    /// Creates a new TEE attestation updated event
    pub fn new_tee_attestation_updated(public_key: String, field: String) -> Self {
        Self::TeeAttestationUpdated {
            public_key,
            field,
            timestamp: env_block_timestamp_seconds(),
        }
    }
}

/// Helper macro to emit events
#[macro_export]
macro_rules! emit_event {
    ($event:expr) => {
        $event.emit();
    };
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{testing_env, VMContext};

    fn get_context() -> VMContext {
        VMContextBuilder::new().build()
    }

    #[test]
    fn test_order_created_event() {
        let context = get_context();
        testing_env!(context);

        let event = ContractEvent::new_order_created(
            "test-order-1".to_string(),
            "ethereum".to_string(),
            "near".to_string(),
            "0xTokenAddress".to_string(),
            "wrap.near".to_string(),
            1000000000000000000, // 1 ETH
        );

        event.emit();
    }
    
    #[test]
    fn test_error_event() {
        let context = get_context();
        testing_env!(context);
        
        // Error with order ID and details
        let event = ContractEvent::new_error(
            Some("test-order-1".to_string()),
            "Insufficient funds",
            Some("User only has 0.9 NEAR but needs 1.0 NEAR".to_string()),
        );
        event.emit();
        
        // Error without order ID or details
        let event = ContractEvent::new_error(None, "Internal error", None);
        event.emit();
    }
}
