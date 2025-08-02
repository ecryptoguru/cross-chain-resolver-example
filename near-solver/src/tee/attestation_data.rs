//! TEE Attestation data structures and validation
//!
//! This module defines the core TEE attestation data structure and its validation logic,
//! providing comprehensive security features for trusted execution environment verification.

use near_sdk::{
    borsh::{self, BorshDeserialize, BorshSerialize},
    env, AccountId,
    serde::{Deserialize, Serialize},
};
use schemars::JsonSchema;
use std::collections::HashMap;

use super::{
    types::TeeType,
    errors::TeeAttestationError,
    signature_verification_wasm::verify_tee_signature,
};

/// Represents a TEE attestation with comprehensive validation and security features
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, JsonSchema, Debug, Clone)]
#[serde(crate = "near_sdk::serde")]
pub struct TeeAttestation {
    /// The type of TEE (SGX, SEV, TrustZone, etc.)
    pub tee_type: TeeType,
    
    /// The public key of the TEE in PEM or base64 format
    pub public_key: String,
    
    /// The attestation report from the TEE (base64-encoded)
    pub report: String,
    
    /// The signature of the report (base64-encoded)
    pub signature: String,
    
    /// When the attestation was issued (unix timestamp in seconds)
    pub issued_at: u64,
    
    /// When the attestation expires (unix timestamp in seconds)
    pub expires_at: u64,
    
    /// The NEAR account ID that registered this attestation
    #[schemars(with = "String")]
    pub signer_id: AccountId,
    
    /// The version of the attestation format (semver)
    pub version: String,
    
    /// Additional metadata about the attestation (TEE-specific fields)
    pub metadata: HashMap<String, String>,
    
    /// When this attestation was last updated (unix timestamp in seconds)
    pub updated_at: u64,
    
    /// Whether this attestation is active (can be revoked)
    pub is_active: bool,
}

impl TeeAttestation {
    /// Creates a new TEE attestation with validation
    pub fn new(
        tee_type: TeeType,
        public_key: String,
        report: String,
        signature: String,
        signer_id: AccountId,
        expires_in_seconds: u64,
        metadata: Option<HashMap<String, String>>,
    ) -> Result<Self, TeeAttestationError> {
        let current_timestamp = env::block_timestamp() / 1_000_000_000; // Convert to seconds
        let expires_at = current_timestamp + expires_in_seconds;
        
        // Validate inputs
        if public_key.is_empty() {
            return Err(TeeAttestationError::InvalidReport {
                details: "Public key cannot be empty".to_string(),
            });
        }
        
        if report.is_empty() {
            return Err(TeeAttestationError::InvalidReport {
                details: "Report cannot be empty".to_string(),
            });
        }
        
        if signature.is_empty() {
            return Err(TeeAttestationError::InvalidSignature {
                public_key: public_key.clone(),
                details: "Signature cannot be empty".to_string(),
            });
        }
        
        if expires_in_seconds == 0 {
            return Err(TeeAttestationError::InvalidExpiration {
                expires_at,
                current_time: current_timestamp,
            });
        }
        
        let metadata = metadata.unwrap_or_default();
        
        // Validate TEE-specific metadata
        Self::validate_tee_metadata(&tee_type, &metadata)?;
        
        Ok(Self {
            tee_type,
            public_key,
            report,
            signature,
            issued_at: current_timestamp,
            expires_at,
            signer_id,
            version: "1.0.0".to_string(),
            metadata,
            updated_at: current_timestamp,
            is_active: true,
        })
    }
    
    /// Validates the attestation against current time and signature verification
    pub fn validate(&self, current_timestamp: u64, verify_signature: bool) -> Result<(), TeeAttestationError> {
        // Check if attestation is active
        if !self.is_active {
            return Err(TeeAttestationError::NotActive {
                public_key: self.public_key.clone(),
            });
        }
        
        // Check expiration
        if current_timestamp > self.expires_at {
            return Err(TeeAttestationError::Expired {
                public_key: self.public_key.clone(),
                expired_at: self.expires_at,
                current_time: current_timestamp,
            });
        }
        
        // Verify signature if requested
        if verify_signature {
            self.verify_signature()?;
        }
        
        Ok(())
    }
    
    /// Checks if the attestation is currently valid
    pub fn is_valid(&self, current_timestamp: u64) -> bool {
        self.is_active && current_timestamp <= self.expires_at
    }
    
    /// Extends the expiration time of the attestation
    pub fn extend_expiration(&mut self, additional_seconds: u64) -> Result<(), TeeAttestationError> {
        let current_timestamp = env::block_timestamp() / 1_000_000_000;
        
        if !self.is_active {
            return Err(TeeAttestationError::NotActive {
                public_key: self.public_key.clone(),
            });
        }
        
        self.expires_at += additional_seconds;
        self.updated_at = current_timestamp;
        
        Ok(())
    }
    
    /// Revokes the attestation
    pub fn revoke(&mut self) -> Result<(), TeeAttestationError> {
        if !self.is_active {
            return Err(TeeAttestationError::Revoked {
                public_key: self.public_key.clone(),
                at: self.updated_at,
            });
        }
        
        self.is_active = false;
        self.updated_at = env::block_timestamp() / 1_000_000_000;
        
        Ok(())
    }
    
    /// Updates the metadata of the attestation
    pub fn update_metadata(&mut self, new_metadata: HashMap<String, String>) -> Result<(), TeeAttestationError> {
        if !self.is_active {
            return Err(TeeAttestationError::NotActive {
                public_key: self.public_key.clone(),
            });
        }
        
        // Validate TEE-specific metadata
        Self::validate_tee_metadata(&self.tee_type, &new_metadata)?;
        
        self.metadata = new_metadata;
        self.updated_at = env::block_timestamp() / 1_000_000_000;
        
        Ok(())
    }
    
    /// Verifies the attestation signature using cryptographic verification
    fn verify_signature(&self) -> Result<(), TeeAttestationError> {
        verify_tee_signature(
            &self.tee_type,
            &self.public_key,
            &self.report,
            &self.signature,
            &self.metadata,
        )
    }
    
    /// Validates TEE-specific metadata requirements
    fn validate_tee_metadata(tee_type: &TeeType, metadata: &HashMap<String, String>) -> Result<(), TeeAttestationError> {
        match tee_type {
            TeeType::Sgx => {
                // SGX requires specific metadata fields
                let required_fields = ["sgx_mr_enclave", "sgx_mr_signer", "sgx_isv_prod_id", "sgx_isv_svn"];
                for field in &required_fields {
                    if !metadata.contains_key(*field) {
                        return Err(TeeAttestationError::MissingMetadata {
                            field: field.to_string(),
                            tee_type: tee_type.to_string(),
                        });
                    }
                }
            }
            TeeType::Sev => {
                // SEV-specific validation
                if !metadata.contains_key("sev_policy") {
                    return Err(TeeAttestationError::MissingMetadata {
                        field: "sev_policy".to_string(),
                        tee_type: tee_type.to_string(),
                    });
                }
            }
            TeeType::TrustZone => {
                // TrustZone-specific validation
                if !metadata.contains_key("trustzone_version") {
                    return Err(TeeAttestationError::MissingMetadata {
                        field: "trustzone_version".to_string(),
                        tee_type: tee_type.to_string(),
                    });
                }
            }
            _ => {
                // Other TEE types may have their own requirements in the future
            }
        }
        
        Ok(())
    }
}
