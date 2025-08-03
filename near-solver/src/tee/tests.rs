//! Comprehensive tests for the TEE attestation module
//!
//! This module contains tests for all components of the TEE attestation system,
//! including types, errors, attestation data, and registry functionality.

#[cfg(test)]
mod signature_verification_tests;

#[cfg(test)]
mod tests {
    use super::super::{
        types::TeeType,
        errors::TeeAttestationError,
        attestation_data::TeeAttestation,
        registry_impl::TeeAttestationRegistry,
    };
    use near_sdk::{
        test_utils::{accounts, VMContextBuilder},
        testing_env, AccountId,
    };
    use std::collections::HashMap;

    /// Helper function to create a test attestation
    fn create_test_attestation() -> TeeAttestation {
        let mut metadata = HashMap::new();
        metadata.insert("sgx_mr_enclave".to_string(), "test_enclave".to_string());
        metadata.insert("sgx_mr_signer".to_string(), "test_signer".to_string());
        metadata.insert("sgx_isv_prod_id".to_string(), "1".to_string());
        metadata.insert("sgx_isv_svn".to_string(), "1".to_string());

        TeeAttestation::new(
            TeeType::Sgx,
            "test_public_key".to_string(),
            "test_report".to_string(),
            "test_signature".to_string(),
            accounts(0),
            3600, // 1 hour expiration
            Some(metadata),
        ).expect("Failed to create test attestation")
    }

    /// Helper function to set up test context
    fn setup_test_context() -> VMContextBuilder {
        let mut context = VMContextBuilder::new();
        context
            .current_account_id(accounts(0))
            .signer_account_id(accounts(1))
            .predecessor_account_id(accounts(1));
        context
    }

    #[test]
    fn test_tee_type_display() {
        assert_eq!(TeeType::Sgx.to_string(), "sgx");
        assert_eq!(TeeType::Sev.to_string(), "sev");
        assert_eq!(TeeType::TrustZone.to_string(), "trustzone");
        assert_eq!(TeeType::Asylo.to_string(), "asylo");
        assert_eq!(TeeType::AzureAttestation.to_string(), "azure_attestation");
        assert_eq!(TeeType::AwsNitro.to_string(), "aws_nitro");
        assert_eq!(TeeType::Other("custom".to_string()).to_string(), "other:custom");
    }

    #[test]
    fn test_tee_type_from_str() {
        use std::str::FromStr;
        
        assert_eq!(TeeType::from_str("sgx").unwrap(), TeeType::Sgx);
        assert_eq!(TeeType::from_str("sev").unwrap(), TeeType::Sev);
        assert_eq!(TeeType::from_str("trustzone").unwrap(), TeeType::TrustZone);
        assert_eq!(TeeType::from_str("trust_zone").unwrap(), TeeType::TrustZone);
        assert_eq!(TeeType::from_str("asylo").unwrap(), TeeType::Asylo);
        assert_eq!(TeeType::from_str("azure_attestation").unwrap(), TeeType::AzureAttestation);
        assert_eq!(TeeType::from_str("azure").unwrap(), TeeType::AzureAttestation);
        assert_eq!(TeeType::from_str("aws_nitro").unwrap(), TeeType::AwsNitro);
        assert_eq!(TeeType::from_str("nitro").unwrap(), TeeType::AwsNitro);
        assert_eq!(TeeType::from_str("other:custom").unwrap(), TeeType::Other("custom".to_string()));
        
        assert!(TeeType::from_str("invalid").is_err());
    }

    #[test]
    fn test_tee_type_properties() {
        assert!(TeeType::Sgx.is_production_ready());
        assert!(TeeType::Sev.is_production_ready());
        assert!(TeeType::TrustZone.is_production_ready());
        assert!(!TeeType::Asylo.is_production_ready());
        
        assert!(!TeeType::Sgx.is_cloud_based());
        assert!(TeeType::AzureAttestation.is_cloud_based());
        assert!(TeeType::AwsNitro.is_cloud_based());
    }

    #[test]
    fn test_attestation_creation() {
        let context = setup_test_context();
        testing_env!(context.build());

        let attestation = create_test_attestation();
        
        assert_eq!(attestation.tee_type, TeeType::Sgx);
        assert_eq!(attestation.public_key, "test_public_key");
        assert_eq!(attestation.report, "test_report");
        assert_eq!(attestation.signature, "test_signature");
        assert!(attestation.is_active);
        assert_eq!(attestation.version, "1.0.0");
    }

    #[test]
    fn test_attestation_validation() {
        let context = setup_test_context();
        testing_env!(context.build());

        let attestation = create_test_attestation();
        let current_timestamp = near_sdk::env::block_timestamp() / 1_000_000_000;
        
        // Should be valid when not expired
        assert!(attestation.validate(current_timestamp, false).is_ok());
        
        // Should be invalid when expired
        let expired_timestamp = attestation.expires_at + 1;
        assert!(matches!(
            attestation.validate(expired_timestamp, false),
            Err(TeeAttestationError::Expired { .. })
        ));
    }

    #[test]
    fn test_registry_initialization() {
        let context = setup_test_context();
        testing_env!(context.build());

        let registry = TeeAttestationRegistry::new(accounts(1));
        assert_eq!(registry.admin, accounts(1));
        assert!(!registry.is_paused);
    }

    #[test]
    fn test_register_and_verify_attestation() {
        let context = setup_test_context();
        testing_env!(context.build());

        let mut registry = TeeAttestationRegistry::new(accounts(1));
        let public_key = "test_public_key".to_string();
        
        let mut metadata = HashMap::new();
        metadata.insert("sgx_mr_enclave".to_string(), "test_enclave".to_string());
        metadata.insert("sgx_mr_signer".to_string(), "test_signer".to_string());
        metadata.insert("sgx_isv_prod_id".to_string(), "1".to_string());
        metadata.insert("sgx_isv_svn".to_string(), "1".to_string());

        // Register attestation
        let result = registry.register_attestation(
            public_key.clone(),
            TeeType::Sgx,
            "test_report".to_string(),
            "test_signature".to_string(),
            3600, // 1 hour expiration
            Some(metadata),
        );
        
        assert!(result.is_ok());
        
        // Get attestation
        let stored_attestation = registry.get_attestation(public_key.clone())
            .expect("Attestation not found");
        assert_eq!(stored_attestation.public_key, public_key);
        
        // Verify attestation (passing false to skip signature verification in tests)
        let verify_result = registry.verify_attestation(public_key.clone(), false);
        assert!(verify_result.is_ok());
    }

    #[test]
    fn test_revoke_attestation() {
        let context = setup_test_context();
        testing_env!(context.build());

        let mut registry = TeeAttestationRegistry::new(accounts(1));
        let public_key = "test_public_key".to_string();
        
        let mut metadata = HashMap::new();
        metadata.insert("sgx_mr_enclave".to_string(), "test_enclave".to_string());
        metadata.insert("sgx_mr_signer".to_string(), "test_signer".to_string());
        metadata.insert("sgx_isv_prod_id".to_string(), "1".to_string());
        metadata.insert("sgx_isv_svn".to_string(), "1".to_string());

        // Register attestation
        registry.register_attestation(
            public_key.clone(),
            TeeType::Sgx,
            "test_report".to_string(),
            "test_signature".to_string(),
            3600,
            Some(metadata),
        ).expect("Failed to register attestation");
        
        // Revoke attestation
        let revoke_result = registry.revoke_attestation(public_key.clone());
        assert!(revoke_result.is_ok());
        
        // Get the attestation after revocation
        let revoked_attestation = registry.get_attestation(public_key.clone())
            .expect("Attestation not found after revocation");
            
        // Verify attestation is no longer active
        assert!(!revoked_attestation.is_active);
        
        // Verify attestation validation fails
        let validation_result = registry.verify_attestation(public_key.clone(), false);
        assert!(matches!(
            validation_result,
            Err(TeeAttestationError::NotActive { .. })
        ));
    }

    #[test]
    fn test_extend_attestation() {
        let context = setup_test_context();
        testing_env!(context.build());

        let mut registry = TeeAttestationRegistry::new(accounts(1));
        let public_key = "test_public_key".to_string();
        
        let mut metadata = HashMap::new();
        metadata.insert("sgx_mr_enclave".to_string(), "test_enclave".to_string());
        metadata.insert("sgx_mr_signer".to_string(), "test_signer".to_string());
        metadata.insert("sgx_isv_prod_id".to_string(), "1".to_string());
        metadata.insert("sgx_isv_svn".to_string(), "1".to_string());

        // Register attestation
        let original_attestation = registry.register_attestation(
            public_key.clone(),
            TeeType::Sgx,
            "test_report".to_string(),
            "test_signature".to_string(),
            3600,
            Some(metadata),
        ).expect("Failed to register attestation");
        
        let original_expires_at = original_attestation.expires_at;
        
        // Extend attestation
        let extended_attestation = registry.extend_attestation(public_key.clone(), 1800)
            .expect("Failed to extend attestation");
        
        assert_eq!(extended_attestation.expires_at, original_expires_at + 1800);
    }

    #[test]
    fn test_unauthorized_access() {
        // Set up context with unauthorized caller (hacker)
        let hacker: AccountId = "hacker.near".parse().unwrap();
        let owner: AccountId = "owner.near".parse().unwrap();
        
        // First, set up the registry with the owner as admin
        let mut context = VMContextBuilder::new()
            .predecessor_account_id(owner.clone())
            .build();
        testing_env!(context.clone());
        
        let mut registry = TeeAttestationRegistry::new(owner);
        
        // Now switch to hacker context
        context.predecessor_account_id = hacker;
        testing_env!(context);
        
        // This should fail with Unauthorized
        let result = registry.register_attestation(
            "test_key".to_string(),
            TeeType::Sgx,
            "test_report".to_string(),
            "test_signature".to_string(),
            3600,
            None,
        );
        
        // Check that we got an error
        assert!(matches!(
            result,
            Err(TeeAttestationError::Unauthorized { .. })
        ), "Expected Unauthorized error but got {:?}", result);
    }

    #[test]
    fn test_pause_unpause() {
        let context = setup_test_context();
        testing_env!(context.build());

        let mut registry = TeeAttestationRegistry::new(accounts(1));
        
        // Initially not paused
        assert!(!registry.is_paused);
        
        // Pause registry
        let pause_result = registry.pause();
        assert!(pause_result.is_ok());
        assert!(registry.is_paused);
        
        // Unpause registry
        let unpause_result = registry.unpause();
        assert!(unpause_result.is_ok());
        assert!(!registry.is_paused);
    }

    #[test]
    fn test_sgx_metadata_validation() {
        let context = setup_test_context();
        testing_env!(context.build());

        // Test with missing SGX metadata
        let result = TeeAttestation::new(
            TeeType::Sgx,
            "test_key".to_string(),
            "test_report".to_string(),
            "test_signature".to_string(),
            accounts(0),
            3600,
            None, // No metadata
        );
        
        assert!(matches!(
            result,
            Err(TeeAttestationError::MissingMetadata { .. })
        ));
        
        // Test with incomplete SGX metadata
        let mut incomplete_metadata = HashMap::new();
        incomplete_metadata.insert("sgx_mr_enclave".to_string(), "test".to_string());
        // Missing other required fields
        
        let result = TeeAttestation::new(
            TeeType::Sgx,
            "test_key".to_string(),
            "test_report".to_string(),
            "test_signature".to_string(),
            accounts(0),
            3600,
            Some(incomplete_metadata),
        );
        
        assert!(matches!(
            result,
            Err(TeeAttestationError::MissingMetadata { .. })
        ));
    }
}
