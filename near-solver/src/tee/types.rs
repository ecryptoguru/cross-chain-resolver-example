//! Type definitions for TEE attestation
//!
//! This module defines the types used in the TEE attestation module.

use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::serde::{Deserialize, Serialize};
use std::fmt;

/// Types of Trusted Execution Environments supported
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde")]
pub enum TeeType {
    /// Intel SGX
    Sgx,
    /// AMD SEV
    Sev,
    /// ARM TrustZone
    TrustZone,
    /// Google Asylo
    Asylo,
    /// Azure Confidential Computing
    Azure,
    /// AWS Nitro Enclaves
    AwsNitro,
    /// Other TEE type
    Other(String),
}

impl fmt::Display for TeeType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Sgx => write!(f, "sgx"),
            Self::Sev => write!(f, "sev"),
            Self::TrustZone => write!(f, "trustzone"),
            Self::Asylo => write!(f, "asylo"),
            Self::Azure => write!(f, "azure"),
            Self::AwsNitro => write!(f, "aws_nitro"),
            Self::Other(s) => write!(f, "other:{}", s),
        }
    }
}

impl std::str::FromStr for TeeType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "sgx" => Ok(Self::Sgx),
            "sev" => Ok(Self::Sev),
            "trustzone" => Ok(Self::TrustZone),
            "asylo" => Ok(Self::Asylo),
            "azure" => Ok(Self::Azure),
            "aws_nitro" => Ok(Self::AwsNitro),
            s if s.starts_with("other:") => {
                let other_type = s.strip_prefix("other:").unwrap_or(s).to_string();
                Ok(Self::Other(other_type))
            }
            _ => Err(format!("Unknown TEE type: {}", s)),
        }
    }
}
