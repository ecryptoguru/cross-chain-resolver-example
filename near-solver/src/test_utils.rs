//! Test utilities for the NEAR solver contract

use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, VMContext, AccountId};
use near_sdk::NearToken;
use p256::ecdsa::{SigningKey, Signature, VerifyingKey, signature::Signer};
use rand_core::OsRng;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};

/// Create a test context with the given parameters
pub fn get_context(
    predecessor_account_id: AccountId,
    deposit: u128,
    is_view: bool,
) -> VMContext {
    // For testing purposes, we'll create a NearToken directly from yoctoNEAR
    let deposit_token = NearToken::from_yoctonear(deposit);
    
    let context = VMContextBuilder::new()
        .current_account_id(account("contract.near"))
        .signer_account_id(predecessor_account_id.clone())
        .predecessor_account_id(predecessor_account_id)
        .attached_deposit(deposit_token)
        .is_view(is_view)
        .build();
    
    testing_env!(context.clone());
    context
}

/// Setup the testing environment with the given context
pub fn setup_context(context: VMContext) {
    testing_env!(context);
}

/// Helper to create a valid NEAR account ID for testing
pub fn account(account_id: &str) -> AccountId {
    account_id.parse().unwrap_or_else(|_| panic!("Invalid account ID: {}", account_id))
}

/// Helper to create an unvalidated account ID for testing (use with caution)
pub fn unvalidated_account(account_id: &str) -> AccountId {
    account_id.parse().unwrap_or_else(|_| panic!("Invalid account ID: {}", account_id))
}

/// Generates a new ECDSA keypair for testing
/// 
/// # Returns
/// A tuple of (private_key, public_key, public_key_bytes) where:
/// - private_key: Base64-encoded private key
/// - public_key: Base64-encoded public key in SEC1 format
/// - public_key_bytes: Raw public key bytes in SEC1 format (0x04 || x || y)
pub fn generate_ecdsa_keypair() -> (String, String, Vec<u8>) {
    // Generate a new ECDSA keypair
    let signing_key = SigningKey::random(&mut OsRng);
    let verifying_key = VerifyingKey::from(&signing_key);
    
    // Get the private key as bytes
    let private_key_bytes = signing_key.to_bytes();
    
    // Get the public key in SEC1 format (0x04 || x || y)
    let public_key_bytes = verifying_key.to_encoded_point(false);
    let public_key_bytes = public_key_bytes.as_bytes().to_vec();
    
    // Encode keys as base64
    let private_key_b64 = BASE64.encode(&private_key_bytes);
    let public_key_b64 = BASE64.encode(&public_key_bytes);
    
    (private_key_b64, public_key_b64, public_key_bytes)
}

/// Signs a message with the given ECDSA private key
/// 
/// # Arguments
/// * `message` - The message to sign
/// * `private_key_b64` - Base64-encoded ECDSA private key
/// 
/// # Returns
/// Base64-encoded signature in ASN.1 DER format
pub fn sign_message(message: &[u8], private_key_b64: &str) -> String {
    // Decode the private key
    let private_key_bytes = BASE64.decode(private_key_b64)
        .expect("Failed to decode private key");
    
    // Create a signing key from the private key bytes
    let signing_key = SigningKey::from_slice(&private_key_bytes)
        .expect("Invalid private key");
    
    // Sign the message
    let signature: Signature = signing_key.sign(message);
    
    // Convert the signature to ASN.1 DER format
    let der_signature = signature.to_der();
    
    // Encode the signature as base64
    BASE64.encode(der_signature.to_bytes())
}

/// Creates a test SGX report with the given data and signs it
/// 
/// # Arguments
/// * `report_data` - The data to include in the report
/// * `private_key_b64` - Base64-encoded ECDSA private key for signing
/// 
/// # Returns
/// A tuple of (report, signature) where both are base64-encoded
pub fn create_test_sgx_report(report_data: &[u8], private_key_b64: &str) -> (String, String) {
    // In a real SGX environment, this would be the actual SGX report
    // For testing, we'll create a simple structure that looks like an SGX report
    let mut report = Vec::new();
    
    // Add a header
    report.extend_from_slice(b"SGX_REPORT_V1");
    
    // Add the report data (truncate or pad to 64 bytes)
    let mut report_data_padded = [0u8; 64];
    let copy_len = report_data.len().min(64);
    report_data_padded[..copy_len].copy_from_slice(&report_data[..copy_len]);
    report.extend_from_slice(&report_data_padded);
    
    // Add some dummy fields that would be in a real SGX report
    report.extend_from_slice(&[0u8; 32]);  // MRENCLAVE
    report.extend_from_slice(&[1u8; 32]);   // MRSIGNER
    report.extend_from_slice(&[2u8; 2]);    // ISVPRODID
    report.extend_from_slice(&[1u8; 2]);    // ISVSVN
    
    // Sign the report
    let signature = sign_message(&report, private_key_b64);
    
    (BASE64.encode(&report), signature)
}
