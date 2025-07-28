//! Trusted Execution Environment (TEE) attestation handling
//! 
//! This module provides functionality for verifying TEE attestations to ensure
//! the integrity and authenticity of the execution environment for secure
//! cross-chain operations.

use near_sdk::{
    borsh::{self, BorshDeserialize, BorshSerialize},
    env, log, near_bindgen,
    serde::{Deserialize, Serialize},
    AccountId, BorshStorageKey, PromiseResult, require,
    collections::{LookupMap, UnorderedSet},
    PanicOnDefault,
};
use std::collections::HashMap;
use std::fmt;
use std::str::FromStr;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

// Import event module for emitting events
use crate::event::ContractEvent;

/// Represents different types of TEE environments
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Hash)]
#[serde(crate = "near_sdk::serde")]
pub enum TeeType {
    /// Intel Software Guard Extensions (SGX)
    Sgx,
    /// AMD Secure Encrypted Virtualization (SEV)
    Sev,
    /// ARM TrustZone
    TrustZone,
    /// Google Asylo
    Asylo,
    /// Microsoft Azure Attestation
    AzureAttestation,
    /// AWS Nitro Enclaves
    AwsNitro,
    /// Other TEE type (for future compatibility)
    Other(String),
}

impl TeeType {
    /// Returns the string representation of the TEE type
    pub fn as_str(&self) -> &str {
        match self {
            Self::Sgx => "sgx",
            Self::Sev => "sev",
            Self::TrustZone => "trustzone",
            Self::Asylo => "asylo",
            Self::AzureAttestation => "azure_attestation",
            Self::AwsNitro => "aws_nitro",
            Self::Other(s) => s.as_str(),
        }
    }
    
    /// Returns true if this TEE type is considered production-ready
    pub fn is_production_ready(&self) -> bool {
        matches!(self, Self::Sgx | Self::Sev | Self::TrustZone)
    }
    
    /// Returns true if this TEE type is cloud-based
    pub fn is_cloud_based(&self) -> bool {
        matches!(self, Self::AzureAttestation | Self::AwsNitro)
    }
}

impl fmt::Display for TeeType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl FromStr for TeeType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "sgx" => Ok(Self::Sgx),
            "sev" => Ok(Self::Sev),
            "trustzone" | "trust_zone" => Ok(Self::TrustZone),
            "asylo" => Ok(Self::Asylo),
            "azure_attestation" | "azure" => Ok(Self::AzureAttestation),
            "aws_nitro" | "nitro" => Ok(Self::AwsNitro),
            _ if s.starts_with("other:") => Ok(Self::Other(s[6..].to_string())),
            _ => Ok(Self::Other(s.to_string())), // Allow custom TEE types
        }
    }
}

/// Key for storing TEE attestations in the registry
#[derive(BorshSerialize, BorshStorageKey)]
pub enum StorageKey {
    Attestations,
    AttestationOwners,
    AttestationByOwner,
    Paused,
}

/// Registry for managing TEE attestations
#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize, PanicOnDefault)]
pub struct TeeAttestationRegistry {
    /// Mapping from public key to attestation
    attestations: LookupMap<String, TeeAttestation>,
    
    /// Set of all public keys for iteration
    attestation_keys: UnorderedSet<String>,
    
    /// Mapping from owner to their attestation public keys
    attestations_by_owner: LookupMap<AccountId, UnorderedSet<String>>,
    
    /// Whether the registry is paused
    is_paused: bool,
    
    /// Admin account with special privileges
    admin: AccountId,
}

#[near_bindgen]
impl TeeAttestationRegistry {
    /// Initializes a new TEE attestation registry
    #[init]
    pub fn new(admin: AccountId) -> Self {
        Self {
            attestations: LookupMap::new(StorageKey::Attestations),
            attestation_keys: UnorderedSet::new(StorageKey::AttestationOwners),
            attestations_by_owner: LookupMap::new(StorageKey::AttestationByOwner),
            is_paused: false,
            admin,
        }
    }
    
    /// Registers a new TEE attestation
    #[payable]
    pub fn register_attestation(
        &mut self,
        tee_type: TeeType,
        public_key: String,
        report: String,
        signature: String,
        issued_at: u64,
        expires_at: u64,
        version: String,
        metadata: Option<HashMap<String, String>>,
    ) -> Result<(), TeeAttestationError> {
        self.ensure_not_paused()?;
        self.ensure_caller_is_admin()?;
        
        // Check if attestation already exists
        if self.attestations.contains_key(&public_key) {
            return Err(TeeAttestationError::InvalidConfig {
                details: format!("Attestation with public key {} already exists", public_key),
            });
        }
        
        let signer_id = env::signer_account_id();
        let attestation = TeeAttestation::new(
            tee_type,
            public_key.clone(),
            report,
            signature,
            issued_at,
            expires_at,
            signer_id.clone(),
            version,
            metadata,
        )?;
        
        // Store the attestation
        self.attestations.insert(&public_key, &attestation);
        self.attestation_keys.insert(&public_key);
        
        // Update owner mapping
        let mut owner_attestations = self.attestations_by_owner
            .get(&signer_id)
            .unwrap_or_else(|| UnorderedSet::new(StorageKey::AttestationByOwner));
        
        owner_attestations.insert(&public_key);
        self.attestations_by_owner.insert(&signer_id, &owner_attestations);
        
        Ok(())
    }
    
    /// Gets an attestation by public key
    pub fn get_attestation(&self, public_key: String) -> Option<TeeAttestation> {
        self.attestations.get(&public_key)
    }
    
    /// Gets all attestation public keys (paginated)
    pub fn get_attestation_keys(
        &self, 
        from_index: Option<u64>,
        limit: Option<u64>,
    ) -> Vec<String> {
        let start = from_index.unwrap_or(0);
        let limit = limit.unwrap_or(50);
        
        self.attestation_keys
            .iter()
            .skip(start as usize)
            .take(limit as usize)
            .collect()
    }
    
    /// Gets attestations for a specific owner (paginated)
    pub fn get_attestations_by_owner(
        &self,
        owner_id: AccountId,
        from_index: Option<u64>,
        limit: Option<u64>,
    ) -> Vec<TeeAttestation> {
        let start = from_index.unwrap_or(0);
        let limit = limit.unwrap_or(50);
        
        if let Some(keys) = self.attestations_by_owner.get(&owner_id) {
            keys.iter()
                .skip(start as usize)
                .take(limit as usize)
                .filter_map(|key| self.attestations.get(&key))
                .collect()
        } else {
            vec![]
        }
    }
    
    /// Revokes an attestation
    pub fn revoke_attestation(&mut self, public_key: String) -> Result<(), TeeAttestationError> {
        self.ensure_not_paused()?;
        self.ensure_caller_is_admin()?;
        
        let mut attestation = self.attestations
            .get(&public_key)
            .ok_or_else(|| TeeAttestationError::NotFound { 
                public_key: public_key.clone() 
            })?;
        
        attestation.revoke()?;
        
        // Update the attestation in storage
        self.attestations.insert(&public_key, &attestation);
        
        Ok(())
    }
    
    /// Extends the expiration of an attestation
    pub fn extend_attestation_expiration(
        &mut self,
        public_key: String,
        new_expires_at: u64,
    ) -> Result<(), TeeAttestationError> {
        self.ensure_not_paused()?;
        self.ensure_caller_is_admin()?;
        
        let mut attestation = self.attestations
            .get(&public_key)
            .ok_or_else(|| TeeAttestationError::NotFound { 
                public_key: public_key.clone() 
            })?;
        
        attestation.extend_expiration(new_expires_at)?;
        
        // Update the attestation in storage
        self.attestations.insert(&public_key, &attestation);
        
        Ok(())
    }
    
    /// Updates the metadata of an attestation
    pub fn update_attestation_metadata(
        &mut self,
        public_key: String,
        new_metadata: HashMap<String, String>,
    ) -> Result<(), TeeAttestationError> {
        self.ensure_not_paused()?;
        self.ensure_caller_is_admin()?;
        
        let mut attestation = self.attestations
            .get(&public_key)
            .ok_or_else(|| TeeAttestationError::NotFound { 
                public_key: public_key.clone() 
            })?;
        
        attestation.update_metadata(new_metadata)?;
        
        // Update the attestation in storage
        self.attestations.insert(&public_key, &attestation);
        
        Ok(())
    }
    
    /// Pauses the registry (admin only)
    pub fn pause(&mut self) -> Result<(), TeeAttestationError> {
        self.ensure_caller_is_admin()?;
        self.is_paused = true;
        
        // Emit event
        if let Ok(event) = ContractEvent::new_tee_registry_paused(&env::signer_account_id().to_string()) {
            event.emit();
        }
        
        Ok(())
    }
    
    /// Unpauses the registry (admin only)
    pub fn unpause(&mut self) -> Result<(), TeeAttestationError> {
        self.ensure_caller_is_admin()?;
        self.is_paused = false;
        
        // Emit event
        if let Ok(event) = ContractEvent::new_tee_registry_unpaused(&env::signer_account_id().to_string()) {
            event.emit();
        }
        
        Ok(())
    }
    
    /// Verifies a TEE attestation is valid
    pub fn verify_attestation(
        &self,
        public_key: String,
        verify_signature: bool,
    ) -> Result<bool, TeeAttestationError> {
        let attestation = self.attestations
            .get(&public_key)
            .ok_or_else(|| TeeAttestationError::NotFound { 
                public_key: public_key.clone() 
            })?;
        
        let current_timestamp = env::block_timestamp() / 1_000_000_000; // Convert to seconds
        attestation.validate(current_timestamp, verify_signature)?;
        
        Ok(true)
    }
    
    /// Internal: Ensures the registry is not paused
    fn ensure_not_paused(&self) -> Result<(), TeeAttestationError> {
        if self.is_paused {
            return Err(TeeAttestationError::RegistryPaused);
        }
        Ok(())
    }
    
    /// Internal: Ensures the caller is the admin
    fn ensure_caller_is_admin(&self) -> Result<(), TeeAttestationError> {
        if env::signer_account_id() != self.admin {
            return Err(TeeAttestationError::Unauthorized {
                caller: env::signer_account_id(),
                required: "admin".to_string(),
            });
        }
        Ok(())
    }
}

/// Represents a TEE attestation with comprehensive validation and security features
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Debug, Clone)]
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

/// Possible errors during TEE attestation verification
#[derive(Debug, Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub enum TeeAttestationError {
    /// The attestation has expired
    Expired { 
        /// Current timestamp when the error occurred
        current: u64, 
        /// When the attestation expired
        expires_at: u64 
    },
    
    /// The attestation is not yet valid
    NotYetValid { 
        /// Current timestamp when the error occurred
        current: u64, 
        /// When the attestation becomes valid
        valid_from: u64 
    },
    
    /// The signature is invalid
    InvalidSignature { 
        /// Details about the signature validation failure
        details: String 
    },
    
    /// The report is invalid
    InvalidReport { 
        /// Details about the report validation failure
        details: String 
    },
    
    /// The public key is invalid
    InvalidPublicKey { 
        /// Details about the public key validation failure
        details: String 
    },
    
    /// The TEE type is not supported
    UnsupportedTeeType { 
        /// The unsupported TEE type
        tee_type: String 
    },
    
    /// The TEE type is not recommended for production use
    NonProductionTee { 
        /// The non-production TEE type
        tee_type: String 
    },
    
    /// The registry is paused
    RegistryPaused,
    
    /// The caller is not authorized
    Unauthorized { 
        /// The account that attempted the unauthorized action
        caller: AccountId, 
        /// The required permission/role
        required: String 
    },
    
    /// The attestation was not found
    NotFound { 
        /// The public key of the missing attestation
        public_key: String 
    },
    
    /// The configuration is invalid
    InvalidConfig { 
        /// Details about the configuration issue
        details: String 
    },
    
    /// The attestation has been revoked
    Revoked { 
        /// The public key of the revoked attestation
        public_key: String, 
        /// When the attestation was revoked
        at: u64 
    },
    
    /// Other error
    Other { 
        /// Details about the error
        details: String 
    },
}

impl fmt::Display for TeeAttestationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Expired { current, expires_at } => 
                write!(f, "TEE attestation has expired at {}: current timestamp is {}", expires_at, current),
                
            Self::NotYetValid { current, valid_from } => 
                write!(f, "TEE attestation is not yet valid: current timestamp is {}, but it becomes valid at {}", current, valid_from),
                
            Self::InvalidSignature { details } => 
                write!(f, "Invalid TEE attestation signature: {}", details),
                
            Self::InvalidReport { details } => 
                write!(f, "Invalid TEE attestation report: {}", details),
                
            Self::InvalidPublicKey { details } => 
                write!(f, "Invalid TEE public key: {}", details),
                
            Self::UnsupportedTeeType { tee_type } => 
                write!(f, "Unsupported TEE type: {}", tee_type),
                
            Self::NonProductionTee { tee_type } => 
                write!(f, "Non-production TEE type: {}", tee_type),
                
            Self::RegistryPaused => 
                write!(f, "TEE attestation registry is paused"),
                
            Self::Unauthorized { caller, required } => 
                write!(f, "Unauthorized TEE attestation action by {}: requires {}", caller, required),
                
            Self::NotFound { public_key } => 
                write!(f, "TEE attestation not found for public key: {}", public_key),
                
            Self::InvalidConfig { details } => 
                write!(f, "Invalid TEE attestation configuration: {}", details),
                
            Self::Revoked { public_key, at } => 
                write!(f, "TEE attestation has been revoked for public key {}: revoked at {}", public_key, at),
                
            Self::Other { details } => 
                write!(f, "TEE attestation error: {}", details),
        }
    }
}

impl TeeAttestation {
    /// Creates a new TEE attestation with comprehensive validation
    /// 
    /// # Arguments
    /// * `tee_type` - Type of TEE (SGX, SEV, etc.)
    /// * `public_key` - Public key in PEM or base64 format
    /// * `report` - Base64-encoded attestation report
    /// * `signature` - Base64-encoded signature of the report
    /// * `issued_at` - When the attestation was issued (unix timestamp)
    /// * `expires_at` - When the attestation expires (must be in the future)
    /// * `signer_id` - NEAR account ID that registered this attestation
    /// * `version` - Version string (should follow semver)
    /// * `metadata` - Optional additional metadata
    /// 
    /// # Returns
    /// Returns `Ok(Self)` if validation passes, or `TeeAttestationError` if validation fails
    pub fn new(
        tee_type: TeeType,
        public_key: String,
        report: String,
        signature: String,
        issued_at: u64,
        expires_at: u64,
        signer_id: AccountId,
        version: String,
        metadata: Option<HashMap<String, String>>,
    ) -> Result<Self, TeeAttestationError> {
        let current_timestamp = env::block_timestamp() / 1_000_000_000; // Convert from nanoseconds to seconds
        
        // Basic validation
        if public_key.trim().is_empty() {
            return Err(TeeAttestationError::InvalidPublicKey { 
                details: "Public key cannot be empty".to_string() 
            });
        }
        
        if report.trim().is_empty() {
            return Err(TeeAttestationError::InvalidReport { 
                details: "Attestation report cannot be empty".to_string() 
            });
        }
        
        if signature.trim().is_empty() {
            return Err(TeeAttestationError::InvalidSignature { 
                details: "Signature cannot be empty".to_string() 
            });
        }
        
        // Validate timestamps
        if issued_at >= expires_at {
            return Err(TeeAttestationError::InvalidConfig { 
                details: format!("Issued at ({}) must be before expires at ({})", issued_at, expires_at)
            });
        }
        
        if current_timestamp > expires_at {
            return Err(TeeAttestationError::Expired { 
                current: current_timestamp, 
                expires_at 
            });
        }
        
        // Validate version format (simple semver check)
        if !version.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-') {
            return Err(TeeAttestationError::InvalidConfig { 
                details: "Version must be alphanumeric with dots and hyphens only".to_string()
            });
        }
        
        // Warn for non-production TEE types
        if !tee_type.is_production_ready() {
            log!("WARNING: Using non-production TEE type: {}", tee_type);
        }
        
        let attestation = Self {
            tee_type,
            public_key: public_key.trim().to_string(),
            report: report.trim().to_string(),
            signature: signature.trim().to_string(),
            issued_at,
            expires_at,
            signer_id,
            version,
            metadata: metadata.unwrap_or_default(),
            updated_at: current_timestamp,
            is_active: true,
        };
        
        // Emit event for new attestation
        if let Ok(event) = ContractEvent::new_tee_attestation_created(
            &attestation.public_key,
            &attestation.tee_type.to_string(),
            &attestation.signer_id.to_string(),
            attestation.expires_at,
        ) {
            event.emit();
        }
        
        Ok(attestation)
    }

    /// Validates the TEE attestation with comprehensive checks
    /// 
    /// # Arguments
    /// * `current_timestamp` - Current timestamp in seconds
    /// * `verify_signature` - Whether to verify the cryptographic signature
    /// 
    /// # Returns
    /// Returns `Ok(())` if validation passes, or `TeeAttestationError` if validation fails
    pub fn validate(&self, current_timestamp: u64, verify_signature: bool) -> Result<(), TeeAttestationError> {
        // Check if attestation is active
        if !self.is_active {
            return Err(TeeAttestationError::Revoked { 
                public_key: self.public_key.clone(),
                at: self.updated_at,
            });
        }
        
        // Check expiration
        if current_timestamp > self.expires_at {
            return Err(TeeAttestationError::Expired { 
                current: current_timestamp, 
                expires_at: self.expires_at,
            });
        }
        
        // Check if not yet valid
        if current_timestamp < self.issued_at {
            return Err(TeeAttestationError::NotYetValid { 
                current: current_timestamp,
                valid_from: self.issued_at,
            });
        }
        
        // Verify the signature if requested
        if verify_signature {
            self.verify_signature()?;
        }
        
        // Validate the report (TEE-specific)
        self.validate_tee_specific()?;
        
        Ok(())
    }
    
    /// Verifies the cryptographic signature of the attestation report
    fn verify_signature(&self) -> Result<(), TeeAttestationError> {
        // In a real implementation, this would verify the signature against the public key
        // and the report data. This is a simplified version for demonstration.
        
        if self.signature.is_empty() {
            return Err(TeeAttestationError::InvalidSignature {
                details: "Signature is empty".to_string(),
            });
        }
        
        // Placeholder for actual signature verification
        // In a real implementation, this would use cryptographic libraries
        // to verify the signature against the public key and report data.
        let is_valid = !self.signature.contains("INVALID");
        
        if !is_valid {
            return Err(TeeAttestationError::InvalidSignature {
                details: "Signature verification failed".to_string(),
            });
        }
        
        Ok(())
    }
    
    /// Validates TEE-specific requirements based on the TEE type
    fn validate_tee_specific(&self) -> Result<(), TeeAttestationError> {
        match self.tee_type {
            TeeType::Sgx => self.validate_sgx(),
            TeeType::Sev => self.validate_sev(),
            TeeType::TrustZone => self.validate_trustzone(),
            TeeType::AwsNitro => self.validate_aws_nitro(),
            TeeType::AzureAttestation => self.validate_azure_attestation(),
            _ => Ok(()), // Skip validation for other TEE types
        }
    }
    
    /// Validates SGX-specific requirements
    fn validate_sgx(&self) -> Result<(), TeeAttestationError> {
        // Check for required SGX-specific fields in metadata
        let mr_enclave = self.metadata.get("sgx_mr_enclave");
        let mr_signer = self.metadata.get("sgx_mr_signer");
        let isv_prod_id = self.metadata.get("sgx_isv_prod_id");
        let isv_svn = self.metadata.get("sgx_isv_svn");
        
        if mr_enclave.is_none() || mr_signer.is_none() || isv_prod_id.is_none() || isv_svn.is_none() {
            return Err(TeeAttestationError::InvalidReport {
                details: "Missing required SGX metadata fields".to_string(),
            });
        }
        
        // Additional SGX-specific validation can be added here
        
        Ok(())
    }
    
    /// Validates SEV-specific requirements
    fn validate_sev(&self) -> Result<(), TeeAttestationError> {
        // Check for required SEV-specific fields in metadata
        if self.metadata.get("sev_build_id").is_none() || 
           self.metadata.get("sev_api_major").is_none() ||
           self.metadata.get("sev_api_minor").is_none() {
            return Err(TeeAttestationError::InvalidReport {
                details: "Missing required SEV metadata fields".to_string(),
            });
        }
        
        // Additional SEV-specific validation can be added here
        
        Ok(())
    }
    
    /// Validates TrustZone-specific requirements
    fn validate_trustzone(&self) -> Result<(), TeeAttestationError> {
        // Check for required TrustZone-specific fields in metadata
        if self.metadata.get("trustzone_implementation_id").is_none() ||
           self.metadata.get("trustzone_security_lifecycle").is_none() {
            return Err(TeeAttestationError::InvalidReport {
                details: "Missing required TrustZone metadata fields".to_string(),
            });
        }
        
        // Additional TrustZone-specific validation can be added here
        
        Ok(())
    }
    
    /// Validates AWS Nitro-specific requirements
    fn validate_aws_nitro(&self) -> Result<(), TeeAttestationError> {
        // Check for required AWS Nitro-specific fields in metadata
        if self.metadata.get("aws_nitro_pcr0").is_none() ||
           self.metadata.get("aws_nitro_pcr8").is_none() {
            return Err(TeeAttestationError::InvalidReport {
                details: "Missing required AWS Nitro metadata fields".to_string(),
            });
        }
        
        // Additional AWS Nitro-specific validation can be added here
        
        Ok(())
    }
    
    /// Validates Azure Attestation-specific requirements
    fn validate_azure_attestation(&self) -> Result<(), TeeAttestationError> {
        // Check for required Azure Attestation-specific fields in metadata
        if self.metadata.get("azure_attestation_endpoint").is_none() ||
           self.metadata.get("azure_runtime_claims").is_none() {
            return Err(TeeAttestationError::InvalidReport {
                details: "Missing required Azure Attestation metadata fields".to_string(),
            });
        }
        
        // Additional Azure Attestation-specific validation can be added here
        
        Ok(())
    }
    
    /// Revokes this attestation
    pub fn revoke(&mut self) -> Result<(), TeeAttestationError> {
        if !self.is_active {
            return Err(TeeAttestationError::Revoked {
                public_key: self.public_key.clone(),
                at: self.updated_at,
            });
        }
        
        self.is_active = false;
        self.updated_at = env::block_timestamp() / 1_000_000_000; // Convert to seconds
        
        // Emit event for revocation
        if let Ok(event) = ContractEvent::new_tee_attestation_revoked(
            &self.public_key,
            &self.tee_type.to_string(),
            &self.signer_id.to_string(),
            self.updated_at,
        ) {
            event.emit();
        }
        
        Ok(())
    }
    
    /// Extends the expiration time of this attestation
    pub fn extend_expiration(&mut self, new_expires_at: u64) -> Result<(), TeeAttestationError> {
        let current_timestamp = env::block_timestamp() / 1_000_000_000; // Convert to seconds
        
        if new_expires_at <= current_timestamp {
            return Err(TeeAttestationError::InvalidConfig {
                details: "New expiration must be in the future".to_string(),
            });
        }
        
        if new_expires_at <= self.expires_at {
            return Err(TeeAttestationError::InvalidConfig {
                details: "New expiration must be after current expiration".to_string(),
            });
        }
        
        let old_expires_at = self.expires_at;
        self.expires_at = new_expires_at;
        self.updated_at = current_timestamp;
        
        // Emit event for expiration extension
        if let Ok(event) = ContractEvent::new_tee_attestation_extended(
            &self.public_key,
            &self.tee_type.to_string(),
            &self.signer_id.to_string(),
            old_expires_at,
            new_expires_at,
        ) {
            event.emit();
        }
        
        Ok(())
    }
    
    /// Updates the metadata of this attestation
    pub fn update_metadata(&mut self, new_metadata: HashMap<String, String>) -> Result<(), TeeAttestationError> {
        if !self.is_active {
            return Err(TeeAttestationError::Revoked {
                public_key: self.public_key.clone(),
                at: self.updated_at,
            });
        }
        
        let old_metadata = std::mem::replace(&mut self.metadata, new_metadata);
        self.updated_at = env::block_timestamp() / 1_000_000_000; // Convert to seconds
        
        // Emit event for metadata update
        if let Ok(event) = ContractEvent::new_tee_attestation_updated(
            &self.public_key,
            &self.tee_type.to_string(),
            &self.signer_id.to_string(),
            &serde_json::to_string(&old_metadata).unwrap_or_default(),
            &serde_json::to_string(&self.metadata).unwrap_or_default(),
        ) {
            event.emit();
        }
        
        Ok(())
    }
    
    /// Returns true if this attestation is expired
    pub fn is_expired(&self, current_timestamp: u64) -> bool {
        current_timestamp > self.expires_at
    }
    
    /// Returns true if this attestation is active and not expired
    pub fn is_valid(&self, current_timestamp: u64) -> bool {
        self.is_active && 
        current_timestamp >= self.issued_at && 
        current_timestamp <= self.expires_at
    }
    
    /// Returns the time remaining until expiration in seconds
    pub fn time_remaining(&self, current_timestamp: u64) -> Option<u64> {
        if current_timestamp >= self.expires_at {
            None
        } else {
            Some(self.expires_at - current_timestamp)
        }
    }
    
    /// Validates the TEE attestation
    pub fn validate(&self, current_timestamp: u64) -> Result<(), TeeAttestationError> {
        // Check if the attestation has expired
        if current_timestamp > self.expires_at {
            return Err(TeeAttestationError::Expired);
        }

        // Check if the attestation is not yet valid
        if current_timestamp < self.issued_at {
            return Err(TeeAttestationError::NotYetValid);
        }

        // Validate the TEE type
        match self.tee_type {
            TeeType::Sgx | TeeType::Sev | TeeType::TrustZone => {}
            TeeType::Other(_) => {
                log!("Warning: Using non-standard TEE type");
            }
        }

        // Verify the signature (placeholder - actual implementation depends on TEE type)
        if !self.verify_signature()? {
            return Err(TeeAttestationError::InvalidSignature);
        }

        // Validate the report (placeholder - actual validation depends on TEE type)
        if !self.validate_report()? {
            return Err(TeeAttestationError::InvalidReport);
        }

        Ok(())
    }

    /// Verifies the signature of the attestation
    fn verify_signature(&self) -> Result<bool, TeeAttestationError> {
        // In a real implementation, this would verify the signature using the TEE's public key
        // For now, we'll just check that the signature is not empty
        if self.signature.is_empty() {
            return Err(TeeAttestationError::InvalidSignature);
        }

        // TODO: Implement actual signature verification based on TEE type
        // This is a placeholder that would be replaced with actual verification logic
        match self.tee_type {
            TeeType::Sgx => {
                // Verify SGX quote signature using Intel's attestation service
                // This would typically involve:
                // 1. Decoding the SGX quote
                // 2. Verifying the quote signature with Intel's public key
                // 3. Checking the report data matches expected values
            }
            TeeType::Sev => {
                // Verify SEV attestation report
            }
            TeeType::TrustZone => {
                // Verify TrustZone attestation
            }
            TeeType::Other(_) => {
                // For custom TEE types, we'd need to know how to verify them
                // This could be extended to support plugin-based verification
            }
        }

        // For now, we'll just return true to indicate success
        Ok(true)
    }

    /// Validates the attestation report
    fn validate_report(&self) -> Result<bool, TeeAttestationError> {
        // In a real implementation, this would validate the TEE-specific report
        // For now, we'll just check that the report is not empty
        if self.report.is_empty() {
            return Err(TeeAttestationError::InvalidReport);
        }

        // TODO: Implement actual report validation based on TEE type
        // This would typically involve:
        // 1. Parsing the report format
        // 2. Verifying the report signature
        // 3. Checking the measurements and other security properties

        // For now, we'll just return true to indicate success
        Ok(true)
    }

    /// Gets the public key as bytes
    pub fn public_key_bytes(&self) -> Result<Vec<u8>, TeeAttestationError> {
        // In a real implementation, this would decode the public key from its string representation
        // For now, we'll just convert the string to bytes
        Ok(self.public_key.as_bytes().to_vec())
    }
}

/// Storage key for the TEE attestation registry
#[derive(BorshStorageKey, BorshSerialize)]
pub enum StorageKey {
    TeeAttestationRegistry,
}

/// Registry of trusted TEE attestations
#[near_sdk::near_bindgen]
#[derive(BorshDeserialize, BorshSerialize)]
pub struct TeeAttestationRegistry {
    /// Map of TEE public key to attestation
    attestations: HashMap<String, TeeAttestation>,
    /// List of authorized signers
    authorized_signers: Vec<AccountId>,
    /// Whether the registry is paused
    paused: bool,
}

impl Default for TeeAttestationRegistry {
    fn default() -> Self {
        Self {
            attestations: HashMap::new(),
            authorized_signers: vec![],
            paused: false,
        }
    }
}

#[near_sdk::near_bindgen]
impl TeeAttestationRegistry {
    /// Initializes the registry with the given authorized signers
    #[init]
    pub fn new(authorized_signers: Vec<AccountId>) -> Self {
        assert!(!authorized_signers.is_empty(), "At least one authorized signer is required");
        
        Self {
            attestations: HashMap::new(),
            authorized_signers,
            paused: false,
        }
    }

    /// Adds or updates a TEE attestation
    /// Only callable by the contract owner
    pub fn set_attestation(&mut self, attestation: TeeAttestation) -> bool {
        self.assert_not_paused();
        self.assert_authorized();
        
        // Validate the attestation
        let current_timestamp = env::block_timestamp() / 1_000_000_000; // Convert to seconds
        if let Err(e) = attestation.validate(current_timestamp) {
            env::panic_str(&format!("Invalid TEE attestation: {}", e));
        }
        
        // Store the attestation
        self.attestations.insert(attestation.public_key.clone(), attestation);
        
        true
    }
    
    /// Gets a TEE attestation by public key
    pub fn get_attestation(&self, public_key: String) -> Option<TeeAttestation> {
        self.attestations.get(&public_key).cloned()
    }
    
    /// Removes a TEE attestation
    /// Only callable by the contract owner
    pub fn remove_attestation(&mut self, public_key: String) -> bool {
        self.assert_not_paused();
        self.assert_authorized();
        
        self.attestations.remove(&public_key).is_some()
    }
    
    /// Verifies that a TEE attestation exists and is valid
    pub fn verify_attestation(&self, public_key: String) -> Result<(), TeeAttestationError> {
        let attestation = self.attestations.get(&public_key)
            .ok_or_else(|| TeeAttestationError::Other("Attestation not found".to_string()))?;
        
        let current_timestamp = env::block_timestamp() / 1_000_000_000; // Convert to seconds
        attestation.validate(current_timestamp)
    }
    
    /// Pauses the registry (emergency only)
    /// Only callable by the contract owner
    pub fn pause(&mut self) {
        self.assert_authorized();
        self.paused = true;
    }
    
    /// Unpauses the registry
    /// Only callable by the contract owner
    pub fn unpause(&mut self) {
        self.assert_authorized();
        self.paused = false;
    }
    
    /// Adds an authorized signer
    /// Only callable by the contract owner
    pub fn add_authorized_signer(&mut self, signer: AccountId) {
        self.assert_authorized();
        
        if !self.authorized_signers.contains(&signer) {
            self.authorized_signers.push(signer);
        }
    }
    
    /// Removes an authorized signer
    /// Only callable by the contract owner
    /// At least one authorized signer must remain
    pub fn remove_authorized_signer(&mut self, signer: AccountId) {
        self.assert_authorized();
        
        self.authorized_signers.retain(|s| s != &signer);
        
        // Ensure there's always at least one authorized signer
        assert!(!self.authorized_signers.is_empty(), "At least one authorized signer is required");
    }
    
    // ========== Internal Methods ==========
    
    /// Asserts that the caller is authorized
    fn assert_authorized(&self) {
        let caller = env::predecessor_account_id();
        assert!(
            self.authorized_signers.contains(&caller),
            "Unauthorized: caller is not an authorized signer"
        );
    }
    
    /// Asserts that the registry is not paused
    fn assert_not_paused(&self) {
        assert!(!self.paused, "Contract is paused");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{testing_env, AccountId, VMContext};
    
    fn get_context() -> VMContext {
        VMContextBuilder::new()
            .predecessor_account_id("owner.near".parse().unwrap())
            .build()
    }
    
    fn create_test_attestation() -> TeeAttestation {
        let current_timestamp = 1_000_000_000; // Example timestamp
        
        TeeAttestation {
            tee_type: TeeType::Sgx,
            public_key: "test_public_key".to_string(),
            report: "test_report".to_string(),
            signature: "test_signature".to_string(),
            issued_at: current_timestamp - 3600, // 1 hour ago
            expires_at: current_timestamp + 3600 * 24, // 24 hours from now
            signer_id: "attester.near".parse().unwrap(),
            version: "1.0.0".to_string(),
            metadata: None,
        }
    }
    
    #[test]
    fn test_tee_type_display() {
        assert_eq!(TeeType::Sgx.to_string(), "sgx");
        assert_eq!(TeeType::Sev.to_string(), "sev");
        assert_eq!(TeeType::TrustZone.to_string(), "trustzone");
        assert_eq!(TeeType::Other("custom".to_string()).to_string(), "other:custom");
    }
    
    #[test]
    fn test_tee_type_from_str() {
        assert_eq!(TeeType::from_str("sgx").unwrap(), TeeType::Sgx);
        assert_eq!(TeeType::from_str("SeV").unwrap(), TeeType::Sev);
        assert_eq!(TeeType::from_str("TRUSTZONE").unwrap(), TeeType::TrustZone);
        assert_eq!(
            TeeType::from_str("other:custom").unwrap(),
            TeeType::Other("custom".to_string())
        );
        assert!(TeeType::from_str("invalid").is_err());
    }
    
    #[test]
    fn test_attestation_validation() {
        let mut attestation = create_test_attestation();
        
        // Test valid attestation
        let current_timestamp = 1_000_000_000;
        assert!(attestation.validate(current_timestamp).is_ok());
        
        // Test expired attestation
        let future_timestamp = current_timestamp + 3600 * 25; // 25 hours later
        assert!(matches!(
            attestation.validate(future_timestamp),
            Err(TeeAttestationError::Expired)
        ));
        
        // Test not yet valid
        let past_timestamp = current_timestamp - 3600 * 2; // 2 hours before issue time
        assert!(matches!(
            attestation.validate(past_timestamp),
            Err(TeeAttestationError::NotYetValid)
        ));
        
        // Test invalid signature (empty)
        attestation.signature = String::new();
        assert!(matches!(
            attestation.validate(current_timestamp),
            Err(TeeAttestationError::InvalidSignature)
        ));
    }
    
    #[test]
    fn test_registry_operations() {
        let context = get_context();
        testing_env!(context);
        
        // Initialize registry with owner as authorized signer
        let owner: AccountId = "owner.near".parse().unwrap();
        let mut registry = TeeAttestationRegistry::new(vec![owner.clone()]);
        
        // Create test attestation
        let attestation = create_test_attestation();
        let public_key = attestation.public_key.clone();
        
        // Add attestation
        assert!(registry.set_attestation(attestation.clone()));
        
        // Get attestation
        let stored_attestation = registry.get_attestation(public_key.clone())
            .expect("Attestation not found");
        assert_eq!(stored_attestation.public_key, public_key);
        
        // Verify attestation
        assert!(registry.verify_attestation(public_key.clone()).is_ok());
        
        // Remove attestation
        assert!(registry.remove_attestation(public_key.clone()));
        assert!(registry.get_attestation(public_key).is_none());
    }
    
    #[test]
    #[should_panic(expected = "Unauthorized")]
    fn test_unauthorized_access() {
        let context = VMContextBuilder::new()
            .predecessor_account_id("hacker.near".parse().unwrap())
            .build();
        testing_env!(context);
        
        let mut registry = TeeAttestationRegistry::new(vec!["owner.near".parse().unwrap()]);
        
        // This should panic with unauthorized access
        registry.set_attestation(create_test_attestation());
    }
}
