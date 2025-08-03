//! Error types for TEE attestation operations
//!
//! This module defines comprehensive error types for TEE attestation validation,
//! registry operations, and other TEE-related functionality.

use near_sdk::{
    serde::{Deserialize, Serialize},
    AccountId,
};
use schemars::JsonSchema;
use std::fmt;

/// Possible errors during TEE attestation verification
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(crate = "near_sdk::serde")]
pub enum TeeAttestationError {
    /// The attestation has expired
    Expired {
        public_key: String,
        expired_at: u64,
        current_time: u64,
    },
    /// The attestation signature is invalid
    InvalidSignature {
        public_key: String,
        details: String,
    },
    /// The attestation report is invalid
    InvalidReport {
        details: String,
    },
    /// The attestation was not found
    NotFound {
        public_key: String,
    },
    /// The attestation has been revoked
    Revoked {
        public_key: String,
        at: u64,
    },
    /// The caller is not authorized to perform this operation
    Unauthorized {
        #[schemars(with = "String")]
        caller: AccountId,
        required: String,
    },
    /// The registry is currently paused
    Paused,
    /// The registry is not paused (when trying to unpause)
    NotPaused,
    /// The attestation already exists
    AlreadyExists {
        public_key: String,
    },
    /// Invalid TEE type
    InvalidTeeType {
        tee_type: String,
    },
    /// Missing required metadata fields
    MissingMetadata {
        field: String,
        tee_type: String,
    },
    /// Invalid metadata value
    InvalidMetadata {
        field: String,
        value: String,
        expected: String,
    },
    /// The attestation is not active
    NotActive {
        public_key: String,
    },
    /// Invalid expiration time
    InvalidExpiration {
        expires_at: u64,
        current_time: u64,
    },
    /// Internal error
    Internal {
        message: String,
    },
}

impl fmt::Display for TeeAttestationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Expired { public_key, expired_at, current_time } => {
                write!(f, "TEE attestation {} expired at {} (current time: {})", 
                       public_key, expired_at, current_time)
            }
            Self::InvalidSignature { public_key, details } => {
                write!(f, "Invalid signature for TEE attestation {}: {}", public_key, details)
            }
            Self::InvalidReport { details } => {
                write!(f, "Invalid TEE attestation report: {}", details)
            }
            Self::NotFound { public_key } => {
                write!(f, "TEE attestation not found: {}", public_key)
            }
            Self::Revoked { public_key, at } => {
                write!(f, "TEE attestation {} was revoked at {}", public_key, at)
            }
            Self::Unauthorized { caller, required } => {
                write!(f, "Unauthorized: {} is not authorized (required: {})", caller, required)
            }
            Self::Paused => {
                write!(f, "TEE attestation registry is paused")
            }
            Self::NotPaused => {
                write!(f, "TEE attestation registry is not paused")
            }
            Self::AlreadyExists { public_key } => {
                write!(f, "TEE attestation already exists: {}", public_key)
            }
            Self::InvalidTeeType { tee_type } => {
                write!(f, "Invalid TEE type: {}", tee_type)
            }
            Self::MissingMetadata { field, tee_type } => {
                write!(f, "Missing required metadata field '{}' for TEE type '{}'", field, tee_type)
            }
            Self::InvalidMetadata { field, value, expected } => {
                write!(f, "Invalid metadata value for field '{}': got '{}', expected '{}'", 
                       field, value, expected)
            }
            Self::NotActive { public_key } => {
                write!(f, "TEE attestation is not active: {}", public_key)
            }
            Self::InvalidExpiration { expires_at, current_time } => {
                write!(f, "Invalid expiration time: {} (current time: {})", expires_at, current_time)
            }
            Self::Internal { message } => {
                write!(f, "Internal TEE attestation error: {}", message)
            }
        }
    }
}

impl std::error::Error for TeeAttestationError {}

// Implement AsRef<str> for NEAR FunctionError compatibility
impl AsRef<str> for TeeAttestationError {
    fn as_ref(&self) -> &str {
        match self {
            Self::Expired { .. } => "TEE attestation expired",
            Self::InvalidSignature { .. } => "Invalid TEE signature",
            Self::InvalidReport { .. } => "Invalid TEE report",
            Self::NotFound { .. } => "TEE attestation not found",
            Self::Revoked { .. } => "TEE attestation revoked",
            Self::Unauthorized { .. } => "Unauthorized access",
            Self::Paused => "Registry paused",
            Self::NotPaused => "Registry not paused",
            Self::AlreadyExists { .. } => "TEE attestation already exists",
            Self::InvalidTeeType { .. } => "Invalid TEE type",
            Self::MissingMetadata { .. } => "Missing required metadata",
            Self::InvalidMetadata { .. } => "Invalid metadata value",
            Self::NotActive { .. } => "TEE attestation not active",
            Self::InvalidExpiration { .. } => "Invalid expiration time",
            Self::Internal { .. } => "Internal TEE error",
        }
    }
}
