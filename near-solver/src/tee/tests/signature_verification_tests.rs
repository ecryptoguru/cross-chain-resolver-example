//! Integration tests for TEE signature verification functionality

use near_sdk::{
    testing_env,
    env,
    AccountId,
    VMContext,
};
use std::collections::HashMap;

// Local crate imports
use crate::tee::{
    attestation::TeeAttestation,
    attestation_data::TeeType,
    errors::TeeAttestationError as ErrorsTeeAttestationError,
};

// Import the attestation module's error type
use crate::tee::attestation::TeeAttestationError as AttestationTeeAttestationError;

// Re-export the error type for use in tests
pub(crate) use crate::tee::attestation::TeeAttestationError;

// Test utilities
use near_sdk::test_utils::test_env;

// Helper function to set up test context
fn get_context() -> VMContext {
    let mut context = VMContext::default();
    context.predecessor_account_id = "test.near".parse().unwrap();
    context.signer_account_id = "test.near".parse().unwrap();
    context.signer_account_pk = vec![0, 1, 2];
    context.account_balance = 1_000_000_000_000_000_000_000_000; // 1e24 yoctoNEAR
    context.attached_deposit = 0;
    context.prepaid_gas = 10u64.pow(18);
    context
}

// Helper function to create a test account ID
fn account(id: &str) -> AccountId {
    AccountId::new_unvalidated(id.to_string())
}

// Helper function to create a test attestation with required fields
fn create_test_attestation(
    tee_type: TeeType,
    public_key: String,
    signature: String,
    metadata: HashMap<String, String>,
) -> TeeAttestation {
    let now = env::block_timestamp() / 1_000_000; // Convert to seconds
    
    TeeAttestation {
        tee_type,
        public_key,
        report: "test_report".to_string(),
        signature,
        issued_at: now,
        expires_at: now + 3600, // 1 hour from now
        signer_id: account("owner.near"),
        version: "1.0.0".to_string(),
        metadata: Some(metadata),
        updated_at: now,
        is_active: true,
    }
}

/// Test successful SGX signature verification in test mode
#[test]
fn test_sgx_signature_verification_success() {
    // Set up test context
    let context = get_context();
    testing_env!(context);
    
    // Create test metadata with required SGX fields
    let mut metadata = HashMap::new();
    metadata.insert("mr_enclave".to_string(), "test_mr_enclave".to_string());
    metadata.insert("mr_signer".to_string(), "test_mr_signer".to_string());
    metadata.insert("isv_prod_id".to_string(), "0".to_string());
    metadata.insert("isv_svn".to_string(), "0".to_string());
    
    // Create a test attestation with valid signature
    let test_attestation = create_test_attestation(
        TeeType::Sgx,
        "test_public_key".to_string(),
        "SGX_VERIFICATION_TEST_MODE_SIGNATURE".to_string(),
        metadata,
    );
    
    // Verify the attestation
    let result = test_attestation.verify_signature();
    
    // Should succeed in test mode
    assert!(result.is_ok(), "Signature verification should succeed in test mode: {:?}", result.err());
}

/// Test SGX signature verification with an invalid public key
#[test]
fn test_sgx_signature_verification_invalid_key() {
    // Set up test context
    let context = get_context();
    testing_env!(context);
    
    // Create test metadata with required SGX fields
    let mut metadata = HashMap::new();
    metadata.insert("mr_enclave".to_string(), "test_mr_enclave".to_string());
    metadata.insert("mr_signer".to_string(), "test_mr_signer".to_string());
    metadata.insert("isv_prod_id".to_string(), "0".to_string());
    metadata.insert("isv_svn".to_string(), "0".to_string());
    
    // Create a test attestation with an invalid public key
    let test_attestation = create_test_attestation(
        TeeType::Sgx,
        "invalid_public_key".to_string(),
        "SGX_VERIFICATION_TEST_MODE_SIGNATURE".to_string(),
        metadata,
    );
    
    // Verify the attestation
    let result = test_attestation.verify_signature();
    
    // Should fail with InvalidPublicKey error
    assert!(
        matches!(result, Err(TeeAttestationError::InvalidPublicKey { .. })),
        "Expected InvalidPublicKey error, got {:?}",
        result
    );
}

/// Test SGX signature verification with missing required metadata
#[test]
fn test_sgx_signature_verification_missing_metadata() {
    // Set up test context
    let context = get_context();
    testing_env!(context);
    
    // Create test attestation with missing required SGX fields
    let test_attestation = create_test_attestation(
        TeeType::Sgx,
        "test_public_key".to_string(),
        "SGX_VERIFICATION_TEST_MODE_SIGNATURE".to_string(),
        HashMap::new(), // Empty metadata
    );
    
    // Verify the attestation
    let result = test_attestation.verify_signature();
    
    // Should fail with missing metadata error
    assert!(
        matches!(result, Err(TeeAttestationError::InvalidMetadata { .. })),
        "Expected InvalidMetadata error, got {:?}",
        result
    );
}

/// Test SGX signature verification with expired attestation
#[test]
fn test_sgx_signature_verification_expired() {
    // Set up test context
    let context = get_context();
    testing_env!(context);
    
    // Create test metadata with required SGX fields
    let mut metadata = HashMap::new();
    metadata.insert("mr_enclave".to_string(), "test_mr_enclave".to_string());
    metadata.insert("mr_signer".to_string(), "test_mr_signer".to_string());
    metadata.insert("isv_prod_id".to_string(), "0".to_string());
    metadata.insert("isv_svn".to_string(), "0".to_string());
    
    // Create a test attestation with expired timestamp
    let mut test_attestation = create_test_attestation(
        TeeType::Sgx,
        "test_public_key".to_string(),
        "SGX_VERIFICATION_TEST_MODE_SIGNATURE".to_string(),
        metadata,
    );
    
    // Manually set the expiration to the past
    test_attestation.expires_at = env::block_timestamp() / 1_000_000 - 1;
    
    // Verify the attestation
    let result = test_attestation.verify_signature();
    
    // Should fail with expired error
    assert!(
        matches!(result, Err(TeeAttestationError::AttestationExpired { .. })),
        "Expected AttestationExpired error, got {:?}",
        result
    );
}

/// Test SGX signature verification with an invalid signature
#[test]
fn test_sgx_signature_verification_invalid_signature() {
    // Set up test context
    let context = get_context();
    testing_env!(context);
    
    // Create test metadata with required SGX fields
    let mut metadata = HashMap::new();
    metadata.insert("mr_enclave".to_string(), "test_mr_enclave".to_string());
    metadata.insert("mr_signer".to_string(), "test_mr_signer".to_string());
    metadata.insert("isv_prod_id".to_string(), "0".to_string());
    metadata.insert("isv_svn".to_string(), "0".to_string());
    
    // Create a test attestation with an invalid signature
    let test_attestation = create_test_attestation(
        TeeType::Sgx,
        "test_public_key".to_string(),
        "INVALID_SIGNATURE".to_string(),
        metadata,
    );
    
    // Verify the attestation
    let result = test_attestation.verify_signature();
    
    // Should fail with InvalidSignature error
    assert!(
        matches!(result, Err(TeeAttestationError::InvalidSignature { .. })),
        "Expected InvalidSignature error, got {:?}",
        result
    );
}
#[test]
fn test_sgx_signature_verification_revoked() {
    // Generate a test keypair
    let (private_key, public_key, _) = generate_ecdsa_keypair();
    
    // Create test data
    let test_data = b"test message for revoked attestation";
    
    // Create a test SGX report
    let (report, signature) = create_test_sgx_report(test_data, &private_key);
    
    // Initialize the contract
    let mut contract = setup_contract();
    
    // Create a test attestation using the contract's public API
    let metadata = serde_json::json!({
        "sgx_mr_enclave": "test_enclave",
        "sgx_mr_signer": "test_signer",
        "sgx_isv_prod_id": "1",
        "sgx_isv_svn": "1"
    });
    
    // Register the attestation
    let result = contract.register_attestation(
        TeeType::Sgx,
        public_key,
        report,
        signature,
        3600, // 1 hour expiration
        "1.0.0".to_string(),
        Some(serde_json::to_string(&metadata).unwrap()),
    );
    
    // Get the attestation ID from the event logs
    let attestation_id = result.unwrap();
    
    // Revoke the attestation
    let revoke_result = contract.revoke_attestation(attestation_id.clone());
    assert!(revoke_result.is_ok(), "Failed to revoke attestation");
    
    // Verify the attestation should fail due to revocation
    let is_valid = contract.verify_attestation(attestation_id);
    assert!(!is_valid, "Attestation should be revoked and invalid");
}
