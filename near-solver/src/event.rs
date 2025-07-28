//! Event emission and handling for the cross-chain resolver
//!
//! This module defines the event system for the cross-chain resolver contract.
//! Events are emitted for important state changes and can be used by off-chain
//! services to track the status of cross-chain swaps.

use near_sdk::{
    env,
    serde::{Serialize, Serializer},
    serde_json,
    AccountId,
};
use crate::model::order::OrderStatus;

/// Represents an event emitted by the contract
#[derive(Serialize, Debug, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct ContractEvent {
    /// The event type
    pub event_type: String,
    /// The event data as a JSON string
    pub data: String,
    /// The block timestamp when the event was emitted
    pub timestamp: u64,
}

impl ContractEvent {
    /// Creates a new contract event with the current timestamp
    pub fn new(event_type: &str, data: String) -> Result<Self, serde_json::Error> {
        let timestamp = env::block_timestamp() / 1_000_000_000; // Convert to seconds
        Ok(Self {
            event_type: event_type.to_string(),
            data,
            timestamp,
        })
    }

    /// Emits the event to the blockchain
    pub fn emit(&self) {
        if let Ok(json) = serde_json::to_string(self) {
            env::log_str(&json);
        }
                    "event": "funds_locked",
                    "order_id": order_id,
                    "token": token,
                    "amount": amount.to_string(),
                    "sender": sender,
                    "timestamp": timestamp,
                }).to_string()
            },
            ContractEvent::FundsReleased { order_id, token, amount, recipient, timestamp } => {
                serde_json::json!({
                    "event": "funds_released",
                    "order_id": order_id,
                    "token": token,
                    "amount": amount.to_string(),
                    "recipient": recipient,
                    "timestamp": timestamp,
                }).to_string()
            },
            ContractEvent::Error { order_id, message, details, timestamp } => {
                let mut json = serde_json::json!({
                    "event": "error",
                    "message": message,
                    "timestamp": timestamp,
                });
                
                if let Some(order_id) = order_id {
                    json.as_object_mut().unwrap()
                        .insert("order_id".to_string(), serde_json::Value::String(order_id.clone()));
                }
                
                if let Some(details) = details {
                    json.as_object_mut().unwrap()
                        .insert("details".to_string(), serde_json::Value::String(details.clone()));
                }
                
                json.to_string()
            },
        };
        
        // Log the event in a structured JSON format
        log!(format!("EVENT_JSON:{}", event_json));
    }
    
    /// Emits an error event
    pub fn emit_error(order_id: Option<String>, message: impl Into<String>, details: Option<String>) {
        Self::new_error(order_id, message, details).emit();
    }
    
    /// Emits an error event for a failed promise result
    pub fn emit_promise_error(order_id: Option<String>, result: &PromiseResult, context: &str) {
        match result {
            PromiseResult::NotReady => {
                Self::emit_error(
                    order_id,
                    format!("Promise not ready: {}", context),
                    None,
                );
            }
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
}

/// Helper macro to emit events
#[macro_export]
macro_rules! emit_event {
    ($event:expr) => {
        $crate::event::ContractEvent::from($event).emit();
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
    fn test_order_status_changed_event() {
        let context = get_context();
        testing_env!(context);
        
        let event = ContractEvent::OrderStatusChanged {
            order_id: "test-order-1".to_string(),
            old_status: OrderStatus::Created,
            new_status: OrderStatus::Processing,
            timestamp: 1234567890,
        };
        
        event.emit();
    }
    
    #[test]
    fn test_funds_locked_event() {
        let context = get_context();
        testing_env!(context);
        
        let event = ContractEvent::FundsLocked {
            order_id: "test-order-1".to_string(),
            token: "wrap.near".to_string(),
            amount: 1000000000000000000, // 1 NEAR
            sender: "alice.near".parse().unwrap(),
            timestamp: 1234567890,
        };
        
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
    }    // In a real test, we would capture and verify the log output
    }
}
