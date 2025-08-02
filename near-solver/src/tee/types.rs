//! TEE Type definitions and utilities
//!
//! This module provides comprehensive type definitions for Trusted Execution Environment (TEE)
//! attestations, including support for multiple TEE types and their characteristics.

use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::serde::{Deserialize, Serialize};
use schemars::JsonSchema;
use std::fmt;
use std::str::FromStr;
use std::hash::Hash;

/// Represents different types of TEE environments
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, JsonSchema, Debug, Clone, PartialEq, Eq, Hash)]
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
        match self {
            Self::Other(s) => write!(f, "other:{}", s),
            _ => write!(f, "{}", self.as_str()),
        }
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
            _ => Err(format!("Invalid TEE type: {}", s)),
        }
    }
}
