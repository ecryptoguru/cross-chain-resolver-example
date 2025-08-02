//! Test utilities for TEE signature verification tests

use near_sdk::{
    test_utils::VMContextBuilder,
    AccountId,
    VMContext,
};
use std::str::FromStr;
use std::time::{SystemTime, UNIX_EPOCH};

// Cryptographic operations
use k256::{
    ecdsa::{
        SigningKey,
        Signature as EcdsaSignature,
    },
    SecretKey,
};
use rand_core::OsRng;
use base64;

/// Helper function to create a test account ID
pub fn account(account_id: &str) -> AccountId {
    AccountId::from_str(account_id).unwrap()
}

/// Helper function to generate a test ECDSA keypair
/// Returns (private_key, public_key_base64, key_type)
pub fn generate_ecdsa_keypair() -> (Vec<u8>, String, String) {
    let secret_key = SecretKey::random(&mut OsRng);
    let signing_key = SigningKey::from(secret_key.clone());
    let public_key = signing_key.verifying_key();
    
    (
        secret_key.to_bytes().to_vec(),
        base64::encode(public_key.to_encoded_point(false).as_bytes()),
        "ecdsa".to_string()
    )
}

/// Helper function to create a test SGX report with signature
/// Returns (report, signature)
pub fn create_test_sgx_report(data: &[u8], private_key: &[u8]) -> (String, String) {
    // Create a signing key from the private key
    let signing_key = SigningKey::from_slice(private_key).expect("Invalid private key");
    
    // Create a signature of the data
    let signature: EcdsaSignature = signing_key.sign(data);
    
    // For testing, we'll use a simple format: base64(data) + ":" + base64(signature)
    let report = format!(
        "{}:{}",
        base64::encode(data),
        base64::encode(signature.to_vec())
    );
    
    // Return the report and an empty signature (not used in this implementation)
    (report, String::new())
}

/// Helper function to set up test context with default values
pub fn get_context() -> VMContext {
    VMContextBuilder::new()
        .current_account_id(account("test.near"))
        .signer_account_id(account("test.near"))
        .signer_account_pk(vec![0, 1, 2])
        .predecessor_account_id(account("test.near"))
        .block_index(0)
        .block_timestamp(
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs() * 1_000_000_000,
        )
        .account_balance(0)
        .account_locked_balance(0)
        .storage_usage(0)
        .attached_deposit(0)
        .prepaid_gas(10u64.pow(18))
        .random_seed(vec![0, 1, 2])
        .is_view(false)
        .build()
}
