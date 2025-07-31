use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// Unified types for all NEAR Phase 2 components

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum OrderStatus {
    Pending,
    Processing,
    Filled,
    Cancelled,
    Expired,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrossChainOrder {
    pub id: String,
    pub status: OrderStatus,
    pub maker: String,
    pub taker: Option<String>,
    pub token_in: String,
    pub token_out: String,
    pub amount_in: u128,
    pub amount_out: u128,
    pub chain_in: String,
    pub chain_out: String,
    pub expires_at: u64,
    pub created_at: u64,
    pub hashlock: Option<String>,
    pub timelock: Option<u64>,
    pub metadata: HashMap<String, String>,
}

impl CrossChainOrder {
    pub fn new(
        id: String,
        maker: String,
        token_in: String,
        token_out: String,
        amount_in: u128,
        amount_out: u128,
        chain_in: String,
        chain_out: String,
        expires_at: u64,
    ) -> Self {
        Self {
            id,
            status: OrderStatus::Pending,
            maker,
            taker: None,
            token_in,
            token_out,
            amount_in,
            amount_out,
            chain_in,
            chain_out,
            expires_at,
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
            hashlock: None,
            timelock: None,
            metadata: HashMap::new(),
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.id.is_empty() {
            return Err("Order ID cannot be empty".to_string());
        }
        if self.maker.is_empty() {
            return Err("Maker cannot be empty".to_string());
        }
        if self.amount_in == 0 {
            return Err("Amount in must be greater than 0".to_string());
        }
        if self.amount_out == 0 {
            return Err("Amount out must be greater than 0".to_string());
        }
        if self.expires_at <= self.created_at {
            return Err("Expiration must be in the future".to_string());
        }
        Ok(())
    }

    pub fn set_hashlock(&mut self, hashlock: String) {
        self.hashlock = Some(hashlock);
    }

    pub fn set_timelock(&mut self, timelock: u64) {
        self.timelock = Some(timelock);
    }

    pub fn fill(&mut self, taker: String) -> Result<(), String> {
        if self.status != OrderStatus::Pending {
            return Err("Order is not pending".to_string());
        }
        self.status = OrderStatus::Filled;
        self.taker = Some(taker);
        Ok(())
    }

    pub fn cancel(&mut self) -> Result<(), String> {
        if self.status != OrderStatus::Pending {
            return Err("Order is not pending".to_string());
        }
        self.status = OrderStatus::Cancelled;
        Ok(())
    }

    pub fn is_expired(&self, current_time: u64) -> bool {
        current_time > self.expires_at
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OneInchMetaOrder {
    pub order_id: String,
    pub maker: String,
    pub taker: String,
    pub maker_asset: String,
    pub taker_asset: String,
    pub making_amount: String,
    pub taking_amount: String,
    pub salt: String,
    pub deadline: u64,
    pub signature: String,
    pub interactions: Vec<String>,
}

#[derive(Debug)]
pub enum SolverError {
    InvalidOrder,
    InsufficientLiquidity,
    NetworkError,
    SignatureError,
    ValidationError(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TeeAttestationError {
    Expired,
    InvalidSignature,
    UnsupportedTeeType,
    InvalidReport,
    InvalidPublicKey,
    UnauthorizedSigner,
    ConfigurationError,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeeAttestation {
    pub tee_type: String,
    pub public_key: String,
    pub report: String,
    pub signature: String,
    pub timestamp: u64,
    pub expires_at: u64,
    pub signer_id: String,
    pub attestation_id: String,
    pub version: String,
    pub metadata: Option<serde_json::Value>,
}

// Escrow contract types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EscrowOrder {
    pub id: String,
    pub status: OrderStatus,
    pub created_at: u64,
    pub expires_at: u64,
    pub maker: String,
    pub taker: Option<String>,
    pub token_in: String,
    pub token_out: String,
    pub amount_in: u128,
    pub amount_out: u128,
    pub fee: u128,
    pub hashlock: String,
    pub timelock: u64,
    pub tee_public_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EscrowTeeAttestation {
    pub public_key: String,
    pub owner_id: String,
    pub created_at: u64,
    pub expires_at: u64,
    pub revoked_at: Option<u64>,
    pub metadata: String,
    pub signature: String,
}
