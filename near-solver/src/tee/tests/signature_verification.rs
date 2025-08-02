//! Comprehensive tests for TEE signature verification functionality

use super::super::*;
use super::super::super::test_utils::*;
use near_sdk::test_utils::test_env;
use near_sdk::AccountId;
use std::collections::HashMap;

/// Tests basic SGX signature verification with valid inputs
#[test]
fn test_sgx_signature_verification_basic() {
    // Generate a test keypair
    let (private_key, public_key, _) = generate_ecdsa_keypair();
    
    // Create test data
    let test_data = b"test message for sgx signature verification";
    
    // Create a test SGX report
    let (report, signature) = create_test_sgx_report(test_data, &private_key);
    
    // Create a test attestation
    let mut metadata = HashMap::new();
    metadata.insert("sgx_mr_enclave".to_string(), "test_enclave".to_string());
    metadata.insert("sgx_mr_signer".to_string(), "test_signer".to_string());
    metadata.insert("sgx_isv_prod_id".to_string(), "1".to_string());
    metadata.insert("sgx_isv_svn".to_string(), "1".to_string());
    
    let attestation = TeeAttestation::new(
        TeeType::Sgx,
        public_key,
        report,
        signature,
        3600, // 1 hour expiration
        account("test.near"),
        "1.0.0".to_string(),
        Some(metadata),
    ).expect("Failed to create test attestation");
    
    // Verify the signature
    let result = attestation.verify_signature();
    assert!(result.is_ok(), "Signature verification failed: {:?}", result);
    assert!(result.unwrap(), "Signature should be valid");
}

/// Tests SGX signature verification with an invalid signature
#[test]
fn test_sgx_signature_verification_invalid_signature() {
    // Generate a test keypair
    let (_, public_key, _) = generate_ecdsa_keypair();
    
    // Create a test attestation with an invalid signature
    let mut metadata = HashMap::new();
    metadata.insert("sgx_mr_enclave".to_string(), "test_enclave".to_string());
    metadata.insert("sgx_mr_signer".to_string(), "test_signer".to_string());
    metadata.insert("sgx_isv_prod_id".to_string(), "1".to_string());
    metadata.insert("sgx_isv_svn".to_string(), "1".to_string());
    
    let attestation = TeeAttestation::new(
        TeeType::Sgx,
        public_key,
        "test_report".to_string(),
        "invalid_signature".to_string(),
        3600, // 1 hour expiration
        account("test.near"),
        "1.0.0".to_string(),
        Some(metadata),
    ).expect("Failed to create test attestation");
    
    // Verify the signature should fail
    let result = attestation.verify_signature();
    assert!(result.is_ok(), "Signature verification should handle invalid signatures gracefully");
    assert!(!result.unwrap(), "Signature should be invalid");
}

/// Tests SGX signature verification with an invalid public key
#[test]
fn test_sgx_signature_verification_invalid_public_key() {
    // Create a test attestation with an invalid public key
    let mut metadata = HashMap::new();
    metadata.insert("sgx_mr_enclave".to_string(), "test_enclave".to_string());
    metadata.insert("sgx_mr_signer".to_string(), "test_signer".to_string());
    metadata.insert("sgx_isv_prod_id".to_string(), "1".to_string());
    metadata.insert("sgx_isv_svn".to_string(), "1".to_string());
    
    let attestation = TeeAttestation::new(
        TeeType::Sgx,
        "invalid_public_key".to_string(),
        "test_report".to_string(),
        "test_signature".to_string(),
        3600, // 1 hour expiration
        account("test.near"),
        "1.0.0".to_string(),
        Some(metadata),
    ).expect("Failed to create test attestation");
    
    // Verify the signature should return an error
    let result = attestation.verify_signature();
    assert!(matches!(
        result,
        Err(TeeAttestationError::InvalidPublicKey { .. })
    ), "Expected InvalidPublicKey error, got {:?}", result);
}

/// Tests SGX signature verification with missing required metadata
#[test]
fn test_sgx_signature_verification_missing_metadata() {
    // Generate a test keypair
    let (_, public_key, _) = generate_ecdsa_keypair();
    
    // Create a test attestation with missing metadata
    let attestation = TeeAttestation::new(
        TeeType::Sgx,
        public_key,
        "test_report".to_string(),
        "test_signature".to_string(),
        3600, // 1 hour expiration
        account("test.near"),
        "1.0.0".to_string(),
        None, // No metadata provided
    ).expect("Failed to create test attestation");
    
    // Verify the signature should fail due to missing metadata
    let result = attestation.verify_signature();
    assert!(matches!(
        result,
        Err(TeeAttestationError::InvalidSignature { .. })
    ), "Expected InvalidSignature error due to missing metadata, got {:?}", result);
}

/// Tests SGX signature verification with an expired attestation
#[test]
fn test_sgx_signature_verification_expired() {
    // Generate a test keypair
    let (private_key, public_key, _) = generate_ecdsa_keypair();
    
    // Create test data
    let test_data = b"test message for expired attestation";
    
    // Create a test SGX report
    let (report, signature) = create_test_sgx_report(test_data, &private_key);
    
    // Create a test attestation that's already expired
    let mut metadata = HashMap::new();
    metadata.insert("sgx_mr_enclave".to_string(), "test_enclave".to_string());
    metadata.insert("sgx_mr_signer".to_string(), "test_signer".to_string());
    metadata.insert("sgx_isv_prod_id".to_string(), "1".to_string());
    metadata.insert("sgx_isv_svn".to_string(), "1".to_string());
    
    let mut attestation = TeeAttestation::new(
        TeeType::Sgx,
        public_key,
        report,
        signature,
        3600, // 1 hour expiration
        account("test.near"),
        "1.0.0".to_string(),
        Some(metadata),
    ).expect("Failed to create test attestation");
    
    // Manually set the expiration to the past
    attestation.expires_at = 1; // Far in the past
    
    // Verify the signature should fail due to expiration
    let result = attestation.verify_signature();
    assert!(matches!(
        result,
        Err(TeeAttestationError::Expired { .. })
    ), "Expected Expired error, got {:?}", result);
}

/// Tests SGX signature verification with a revoked attestation
#[test]
fn test_sgx_signature_verification_revoked() {
    // Generate a test keypair
    let (private_key, public_key, _) = generate_ecdsa_keypair();
    
    // Create test data
    let test_data = b"test message for revoked attestation";
    
    // Create a test SGX report
    let (report, signature) = create_test_sgx_report(test_data, &private_key);
    
    // Create a test attestation
    let mut metadata = HashMap::new();
    metadata.insert("sgx_mr_enclave".to_string(), "test_enclave".to_string());
    metadata.insert("sgx_mr_signer".to_string(), "test_signer".to_string());
    metadata.insert("sgx_isv_prod_id".to_string(), "1".to_string());
    metadata.insert("sgx_isv_svn".to_string(), "1".to_string());
    
    let mut attestation = TeeAttestation::new(
        TeeType::Sgx,
        public_key,
        report,
        signature,
        3600, // 1 hour expiration
        account("test.near"),
        "1.0.0".to_string(),
        Some(metadata),
    ).expect("Failed to create test attestation");
    
    // Revoke the attestation
    attestation.revoke().expect("Failed to revoke attestation");
    
    // Verify the signature should fail due to revocation
    let result = attestation.verify_signature();
    assert!(matches!(
        result,
        Err(TeeAttestationError::AlreadyRevoked { .. })
    ), "Expected AlreadyRevoked error, got {:?}", result);
}
