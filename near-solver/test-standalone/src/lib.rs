// Comprehensive NEAR Phase 2 Implementation Tests
// This module contains standalone tests for all NEAR components

pub mod types;
pub mod order_model;
pub mod tee_attestation;
pub mod solver_service;
pub mod escrow_contract;

// Re-export unified types and test modules
pub use types::*;
pub use order_model::*;
pub use tee_attestation::*;
pub use solver_service::*;
pub use escrow_contract::*;

#[cfg(test)]
mod integration_tests {
    use super::*;
    use tokio;

    #[test]
    fn test_unified_types_compatibility() {
        // Test that all components can work with unified types
        let order = CrossChainOrder::new(
            "test_order_1".to_string(),
            "alice.near".to_string(),
            "wrap.near".to_string(),
            "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2".to_string(),
            1_000_000_000_000_000_000_000,
            1_000_000_000_000_000_000,
            "near".to_string(),
            "ethereum".to_string(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs() + 3600,
        );

        // Validate order works with unified types
        assert!(order.validate().is_ok());
        assert_eq!(order.status, OrderStatus::Pending);
    }

    #[test]
    fn test_tee_attestation_integration() {
        // Test TEE attestation creation and validation
        let metadata = serde_json::json!({
            "mrenclave": "abc123",
            "mrsigner": "def456",
            "isv_svn": 1,
            "isv_prod_id": 1,
        });

        let tee = TeeAttestation::new(
            "sgx".to_string(),
            base64::encode("test_public_key"),
            base64::encode("test_report"),
            base64::encode("test_signature"),
            3600, // 1 hour
            Some(metadata),
        ).expect("Failed to create TEE attestation");

        // Validate attestation
        assert!(tee.is_valid());
        assert!(tee.verify_signature().is_ok());
        assert!(tee.validate_report().is_ok());

        // Test data signature verification
        let data = b"test_cross_chain_data";
        let signature = base64::encode("test_data_signature");
        assert!(tee.verify_data_signature(data, &signature).is_ok());
    }

    #[test]
    fn test_order_lifecycle_management() {
        let mut order = CrossChainOrder::new(
            "lifecycle_test".to_string(),
            "alice.near".to_string(),
            "wrap.near".to_string(),
            "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2".to_string(),
            1_000_000_000_000_000_000_000,
            1_000_000_000_000_000_000,
            "near".to_string(),
            "ethereum".to_string(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs() + 3600,
        );

        // Test initial state
        assert_eq!(order.status, OrderStatus::Pending);
        assert!(order.validate().is_ok());

        // Test hashlock and timelock setting
        order.set_hashlock("0x1234567890abcdef".to_string());
        order.set_timelock(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs() + 86400
        );

        assert!(order.hashlock.is_some());
        assert!(order.timelock.is_some());

        // Test order filling
        assert!(order.fill("bob.near".to_string()).is_ok());
        assert_eq!(order.status, OrderStatus::Filled);
        assert_eq!(order.taker, Some("bob.near".to_string()));

        // Test that filled order cannot be filled again
        assert!(order.fill("charlie.near".to_string()).is_err());
    }

    #[test]
    fn test_escrow_contract_integration() {
        let mut escrow = EscrowContract::new(
            "owner.near".to_string(),
            "tee_registry.near".to_string(),
        );

        // Create escrow order
        let escrow_order_id = escrow.create_order(
            "wrap.near".to_string(),
            "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2".to_string(),
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

        assert_eq!(escrow_order_id, "order_1");

        // Verify escrow order was created correctly
        let escrow_order = escrow.get_order(escrow_order_id).unwrap();
        assert_eq!(escrow_order.maker, "alice.near");
        assert_eq!(escrow_order.amount_in, 1_000_000_000_000_000_000_000);
        assert_eq!(escrow_order.amount_out, 1_000_000_000_000_000_000);
    }
}
