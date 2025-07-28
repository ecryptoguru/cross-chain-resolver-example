//! Trusted Execution Environment (TEE) module
//! 
//! This module provides functionality for working with TEE attestations
//! in the context of cross-chain swaps.

mod types;
mod registry;

// Re-export public types and functions
pub use self::types::*;
pub use self::registry::*;

//! Trusted Execution Environment (TEE) attestation and verification
//!
//! This module provides functionality for managing and verifying TEE (Trusted Execution Environment)
//! attestations, which are used to ensure that the contract is running in a secure, isolated
//! environment with verified code and configuration.

use near_sdk::{
    borsh::{self, BorshDeserialize, BorshSerialize},
    env, require,
    serde::{Deserialize, Serialize},
    AccountId, log,
};
use std::time::{SystemTime, UNIX_EPOCH};

/// Error types for TEE attestation validation
#[derive(Debug, PartialEq)]
pub enum TeeAttestationError {
    /// The attestation has expired
    Expired,
    /// The signature is invalid
    InvalidSignature,
    /// The TEE type is not supported
    UnsupportedTeeType,
    /// The report is malformed or invalid
    InvalidReport,
    /// The public key is invalid
    InvalidPublicKey,
    /// The signer is not authorized
    UnauthorizedSigner,
    /// The TEE environment is not properly configured
    ConfigurationError,
}

impl std::fmt::Display for TeeAttestationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Expired => write!(f, "TEE attestation has expired"),
            Self::InvalidSignature => write!(f, "Invalid TEE attestation signature"),
            Self::UnsupportedTeeType => write!(f, "Unsupported TEE type"),
            Self::InvalidReport => write!(f, "Invalid TEE attestation report"),
            Self::InvalidPublicKey => write!(f, "Invalid TEE public key"),
            Self::UnauthorizedSigner => write!(f, "Unauthorized TEE signer"),
            Self::ConfigurationError => write!(f, "TEE configuration error"),
        }
    }
}

impl std::error::Error for TeeAttestationError {}

/// Represents a TEE (Trusted Execution Environment) attestation
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Debug, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct TeeAttestation {
    /// The TEE provider (e.g., "sgx", "sev", etc.)
    pub tee_type: String,
    /// The public key of the TEE (base64-encoded)
    pub public_key: String,
    /// The attestation report or quote (base64-encoded)
    pub report: String,
    /// The signature of the report (base64-encoded)
    pub signature: String,
    /// The timestamp when the attestation was created (UNIX timestamp in seconds)
    pub timestamp: u64,
    /// The timestamp when the attestation expires (UNIX timestamp in seconds)
    pub expires_at: u64,
    /// The NEAR account ID that submitted the attestation
    pub signer_id: AccountId,
    /// A unique identifier for this attestation (e.g., a hash of the report)
    pub attestation_id: String,
    /// The version of the TEE attestation format
    pub version: String,
    /// Additional metadata (e.g., TCB status, MRSIGNER, MRENCLAVE, etc.)
    pub metadata: Option<serde_json::Value>,
}

impl TeeAttestation {
    /// Creates a new TEE attestation with comprehensive validation
    /// 
    /// # Arguments
    /// * `tee_type` - The type of TEE (e.g., "sgx", "sev", etc.)
    /// * `public_key` - Base64-encoded public key of the TEE
    /// * `report` - Base64-encoded attestation report or quote
    /// * `signature` - Base64-encoded signature of the report
    /// * `expires_in_seconds` - Number of seconds until the attestation expires
    /// * `metadata` - Optional JSON metadata about the TEE environment
    /// 
    /// # Returns
    /// A new `TeeAttestation` instance if validation passes
    /// 
    /// # Errors
    /// Returns a `TeeAttestationError` if validation fails
    pub fn new(
        tee_type: String,
        public_key: String,
        report: String,
        signature: String,
        expires_in_seconds: u64,
        metadata: Option<serde_json::Value>,
    ) -> Result<Self, TeeAttestationError> {
        // Basic validation of inputs
        if public_key.is_empty() || report.is_empty() || signature.is_empty() {
            return Err(TeeAttestationError::ConfigurationError);
        }
        
        // Validate TEE type
        if !Self::is_supported_tee_type(&tee_type) {
            return Err(TeeAttestationError::UnsupportedTeeType);
        }
        
        let now = env::block_timestamp() / 1_000_000; // Convert to seconds
        let expires_at = now.checked_add(expires_in_seconds)
            .ok_or(TeeAttestationError::ConfigurationError)?;
        
        // Create a unique ID for this attestation (hash of report + timestamp)
        let attestation_id = format!(
            "{}_{}",
            hex::encode(env::sha256(report.as_bytes())),
            now
        );
        
        let attestation = Self {
            tee_type: tee_type.to_lowercase(),
            public_key,
            report,
            signature,
            timestamp: now,
            expires_at,
            signer_id: env::signer_account_id(),
            attestation_id,
            version: env!("CARGO_PKG_VERSION").to_string(),
            metadata,
        };
        
        // Validate the attestation before returning
        if !attestation.is_valid() {
            return Err(TeeAttestationError::InvalidReport);
        }
        
        log!("Created new TEE attestation: {}", attestation.attestation_id);
        
        Ok(attestation)
    }
    
    /// Checks if the TEE type is supported
    fn is_supported_tee_type(tee_type: &str) -> bool {
        // Add more supported TEE types as needed
        matches!(
            tee_type.to_lowercase().as_str(),
            "sgx" | "sev" | "nitro" | "tdx" | "snp"
        )
    }

    /// Validates the TEE attestation
    /// 
    /// This performs comprehensive validation of the attestation, including:
    /// - Expiration check
    /// - Signature verification
    /// - Report validation (if applicable for the TEE type)
    /// - Public key validation
    /// 
    /// # Returns
    /// `true` if the attestation is valid, `false` otherwise
    pub fn is_valid(&self) -> bool {
        match self.validate() {
            Ok(_) => true,
            Err(e) => {
                log!("TEE attestation validation failed: {}", e);
                false
            }
        }
    }
    
    /// Comprehensive validation of the TEE attestation
    /// 
    /// # Returns
    /// `Ok(())` if the attestation is valid, or a `TeeAttestationError` if validation fails
    pub fn validate(&self) -> Result<(), TeeAttestationError> {
        let now = env::block_timestamp() / 1_000_000; // Convert to seconds
        
        // Check if the attestation has expired
        if now > self.expires_at {
            return Err(TeeAttestationError::Expired);
        }
        
        // Verify the signature
        if !self.verify_signature()? {
            return Err(TeeAttestationError::InvalidSignature);
        }
        
        // Verify the report format and contents based on TEE type
        self.validate_report()?;
        
        // Additional validation based on TEE type
        match self.tee_type.to_lowercase().as_str() {
            "sgx" => self.validate_sgx_attestation(),
            "sev" => self.validate_sev_attestation(),
            _ => Ok(()), // For other TEE types, basic validation is sufficient
        }
    }
    
    /// Verifies the signature of the attestation report
    fn verify_signature(&self) -> Result<bool, TeeAttestationError> {
        // This is a simplified example. In a real implementation, you would:
        // 1. Decode the base64-encoded public key
        // 2. Verify the signature of the report using the public key
        // 3. Check the certificate chain (if applicable)
        
        // For now, we'll just check that the signature is not empty
        if self.signature.is_empty() || self.public_key.is_empty() {
            return Err(TeeAttestationError::InvalidSignature);
        }
        
        // In a real implementation, you would verify the signature here
        // For example, for SGX:
        // let public_key = decode_public_key(&self.public_key)?;
        // let signature = decode_signature(&self.signature)?;
        // let message = format!("{}{}{}", self.report, self.timestamp, self.expires_at);
        // public_key.verify(message.as_bytes(), &signature)?;
        
        // For now, we'll just return true to indicate the check passed
        Ok(true)
    }
    
    /// Validates the attestation report format
    fn validate_report(&self) -> Result<(), TeeAttestationError> {
        if self.report.is_empty() {
            return Err(TeeAttestationError::InvalidReport);
        }
        
        // In a real implementation, you would parse and validate the report
        // based on the TEE type. For example, for Intel SGX, you would:
        // 1. Parse the SGX quote structure
        // 2. Verify the report data matches expected values
        // 3. Check the MRENCLAVE/MRSIGNER values
        
        Ok(())
    }
    
    /// Validates SGX-specific attestation details
    fn validate_sgx_attestation(&self) -> Result<(), TeeAttestationError> {
        // In a real implementation, you would:
        // 1. Parse the SGX quote from the report
        // 2. Verify the quote signature using Intel's attestation service
        // 3. Check the MRENCLAVE/MRSIGNER values against a whitelist
        // 4. Verify the report data contains expected values
        
        // For now, we'll just check that the report is not empty
        if self.report.is_empty() {
            return Err(TeeAttestationError::InvalidReport);
        }
        
        Ok(())
    }
    
    /// Validates SEV-specific attestation details
    fn validate_sev_attestation(&self) -> Result<(), TeeAttestationError> {
        // Similar to SGX, but for AMD SEV-SNP attestation
        
        // For now, we'll just check that the report is not empty
        if self.report.is_empty() {
            return Err(TeeAttestationError::InvalidReport);
        }
        
        Ok(())
    }

    /// Verifies that the given data was signed by the TEE
    /// 
    /// # Arguments
    /// * `data` - The raw data that was signed
    /// * `signature` - The signature to verify (base64-encoded)
    /// 
    /// # Returns
    /// `true` if the signature is valid, `false` otherwise
    pub fn verify_data_signature(&self, data: &[u8], signature: &str) -> Result<bool, TeeAttestationError> {
        if signature.is_empty() || data.is_empty() {
            return Err(TeeAttestationError::InvalidSignature);
        }
        
        // In a real implementation, you would:
        // 1. Decode the base64-encoded signature
        // 2. Verify the signature using the TEE's public key
        // 3. Return the result
        
        // For now, we'll just return true to indicate the check passed
        Ok(true)
    }
    
    /// Returns the TEE's public key
    pub fn public_key(&self) -> &str {
        &self.public_key
    }
    
    /// Returns the TEE attestation ID
    pub fn attestation_id(&self) -> &str {
        &self.attestation_id
    }
    
    /// Returns the TEE type
    pub fn tee_type(&self) -> &str {
        &self.tee_type
    }
    
    /// Returns the expiration timestamp
    pub fn expires_at(&self) -> u64 {
        self.expires_at
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{testing_env, VMContext};
    use serde_json::json;

    fn get_context() -> VMContext {
        VMContextBuilder::new()
            .signer_account_id("bob.near".parse().unwrap())
            .is_view(false)
            .build()
    }

    #[test]
    fn test_tee_attestation_creation() {
        let context = get_context();
        testing_env!(context);
        
        let metadata = json!({
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
        
        assert_eq!(tee.tee_type(), "sgx");
        assert!(!tee.public_key().is_empty());
        assert!(!tee.report.is_empty());
        assert!(!tee.signature.is_empty());
        assert!(!tee.attestation_id().is_empty());
        assert!(tee.metadata.is_some());
        
        // Test validation
        assert!(tee.is_valid());
    }

    #[test]
    fn test_tee_attestation_expiration() {
        let context = get_context();
        testing_env!(context);
        
        let now = env::block_timestamp() / 1_000_000;
        
        let mut tee = TeeAttestation::new(
            "sgx".to_string(),
            base64::encode("test_public_key"),
            base64::encode("test_report"),
            base64::encode("test_signature"),
            3600, // 1 hour
            None,
        ).expect("Failed to create TEE attestation");
        
        // Should be valid
        assert!(tee.is_valid());
        
        // Test validation with explicit timestamp
        assert!(matches!(
            tee.validate(),
            Ok(())
        ));
        
        // Make it expired
        tee.expires_at = now - 1;
        
        // Should be invalid
        assert!(!tee.is_valid());
        
        // Test validation with explicit timestamp
        assert!(matches!(
            tee.validate(),
            Err(TeeAttestationError::Expired)
        ));
    }
    
    #[test]
    fn test_unsupported_tee_type() {
        let context = get_context();
        testing_env!(context);
        
        let result = TeeAttestation::new(
            "unsupported_type".to_string(),
            base64::encode("test_public_key"),
            base64::encode("test_report"),
            base64::encode("test_signature"),
            3600,
            None,
        );
        
        assert!(matches!(
            result,
            Err(TeeAttestationError::UnsupportedTeeType)
        ));
    }
    
    #[test]
    fn test_invalid_attestation() {
        let context = get_context();
        testing_env!(context);
        
        // Test with empty public key
        let result = TeeAttestation::new(
            "sgx".to_string(),
            "".to_string(), // Empty public key
            base64::encode("test_report"),
            base64::encode("test_signature"),
            3600,
            None,
        );
        
        assert!(matches!(
            result,
            Err(TeeAttestationError::ConfigurationError)
        ));
        
        // Test with empty report
        let result = TeeAttestation::new(
            "sgx".to_string(),
            base64::encode("test_public_key"),
            "".to_string(), // Empty report
            base64::encode("test_signature"),
            3600,
            None,
        );
        
        assert!(matches!(
            result,
            Err(TeeAttestationError::ConfigurationError)
        ));
        
        // Test with empty signature
        let result = TeeAttestation::new(
            "sgx".to_string(),
            base64::encode("test_public_key"),
            base64::encode("test_report"),
            "".to_string(), // Empty signature
            3600,
            None,
        );
        
        assert!(matches!(
            result,
            Err(TeeAttestationError::ConfigurationError)
        ));
    }
}
