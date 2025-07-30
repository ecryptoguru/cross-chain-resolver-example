use crate::types::*;
use serde_json;
use sha2::{Digest, Sha256};
use base64;
use std::time::{SystemTime, UNIX_EPOCH};

impl TeeAttestation {
    pub fn new(
        tee_type: String,
        public_key: String,
        report: String,
        signature: String,
        expires_in_seconds: u64,
        metadata: Option<serde_json::Value>,
    ) -> Result<Self, TeeAttestationError> {
        // Validate inputs
        if tee_type.is_empty() || public_key.is_empty() || report.is_empty() || signature.is_empty() {
            return Err(TeeAttestationError::ConfigurationError);
        }

        if !Self::is_supported_tee_type(&tee_type) {
            return Err(TeeAttestationError::UnsupportedTeeType);
        }

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();

        let expires_at = now + expires_in_seconds;

        // Generate attestation ID as hash of key components
        let mut hasher = Sha256::new();
        hasher.update(tee_type.as_bytes());
        hasher.update(public_key.as_bytes());
        hasher.update(report.as_bytes());
        hasher.update(now.to_string().as_bytes());
        let attestation_id = hex::encode(hasher.finalize());

        Ok(Self {
            tee_type,
            public_key,
            report,
            signature,
            timestamp: now,
            expires_at,
            signer_id: "test.near".to_string(), // Simplified for testing
            attestation_id,
            version: "1.0".to_string(),
            metadata,
        })
    }

    pub fn is_supported_tee_type(tee_type: &str) -> bool {
        matches!(tee_type, "sgx" | "sev" | "trustzone" | "asylo" | "azure" | "aws-nitro")
    }

    pub fn is_valid(&self) -> bool {
        self.validate().is_ok()
    }

    pub fn validate(&self) -> Result<(), TeeAttestationError> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();

        // Check expiration
        if now > self.expires_at {
            return Err(TeeAttestationError::Expired);
        }

        // Validate TEE type
        if !Self::is_supported_tee_type(&self.tee_type) {
            return Err(TeeAttestationError::UnsupportedTeeType);
        }

        // Validate public key format (simplified)
        if self.public_key.is_empty() {
            return Err(TeeAttestationError::InvalidPublicKey);
        }

        // Validate report format (simplified)
        if self.report.is_empty() {
            return Err(TeeAttestationError::InvalidReport);
        }

        // Validate signature (simplified - in real implementation would verify cryptographically)
        if self.signature.is_empty() {
            return Err(TeeAttestationError::InvalidSignature);
        }

        Ok(())
    }

    pub fn verify_signature(&self) -> Result<bool, TeeAttestationError> {
        // Simplified signature verification for testing
        // In real implementation, this would use cryptographic verification
        if self.signature.is_empty() {
            return Err(TeeAttestationError::InvalidSignature);
        }
        
        // For testing, assume signature is valid if it's base64 encoded
        base64::decode(&self.signature)
            .map(|_| true)
            .map_err(|_| TeeAttestationError::InvalidSignature)
    }

    pub fn validate_report(&self) -> Result<(), TeeAttestationError> {
        if self.report.is_empty() {
            return Err(TeeAttestationError::InvalidReport);
        }

        // TEE-specific validation
        match self.tee_type.as_str() {
            "sgx" => self.validate_sgx_attestation(),
            "sev" => self.validate_sev_attestation(),
            _ => Ok(()), // Other TEE types pass basic validation
        }
    }

    fn validate_sgx_attestation(&self) -> Result<(), TeeAttestationError> {
        // Simplified SGX validation
        if let Some(metadata) = &self.metadata {
            if !metadata.is_object() {
                return Err(TeeAttestationError::InvalidReport);
            }
            // Check for required SGX fields
            let obj = metadata.as_object().unwrap();
            if !obj.contains_key("mrenclave") || !obj.contains_key("mrsigner") {
                return Err(TeeAttestationError::InvalidReport);
            }
        }
        Ok(())
    }

    fn validate_sev_attestation(&self) -> Result<(), TeeAttestationError> {
        // Simplified SEV validation
        if let Some(metadata) = &self.metadata {
            if !metadata.is_object() {
                return Err(TeeAttestationError::InvalidReport);
            }
        }
        Ok(())
    }

    pub fn verify_data_signature(&self, data: &[u8], signature: &str) -> Result<bool, TeeAttestationError> {
        // Simplified data signature verification for testing
        if signature.is_empty() {
            return Err(TeeAttestationError::InvalidSignature);
        }

        // For testing, verify that signature is base64 encoded
        base64::decode(signature)
            .map(|decoded| !decoded.is_empty() && !data.is_empty())
            .map_err(|_| TeeAttestationError::InvalidSignature)
    }

    // Getter methods
    pub fn public_key(&self) -> &str {
        &self.public_key
    }

    pub fn attestation_id(&self) -> &str {
        &self.attestation_id
    }

    pub fn tee_type(&self) -> &str {
        &self.tee_type
    }

    pub fn expires_at(&self) -> u64 {
        self.expires_at
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_tee_attestation_creation() {
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
        let mut tee = TeeAttestation::new(
            "sgx".to_string(),
            base64::encode("test_public_key"),
            base64::encode("test_report"),
            base64::encode("test_signature"),
            3600, // 1 hour
            None,
        ).expect("Failed to create TEE attestation");

        // Should be valid initially
        assert!(tee.is_valid());
        assert!(matches!(tee.validate(), Ok(())));

        // Make it expired
        tee.expires_at = tee.timestamp - 1;

        // Should be invalid now
        assert!(!tee.is_valid());
        assert!(matches!(tee.validate(), Err(TeeAttestationError::Expired)));
    }

    #[test]
    fn test_unsupported_tee_type() {
        let result = TeeAttestation::new(
            "unsupported_type".to_string(),
            base64::encode("test_public_key"),
            base64::encode("test_report"),
            base64::encode("test_signature"),
            3600,
            None,
        );

        assert!(matches!(result, Err(TeeAttestationError::UnsupportedTeeType)));
    }

    #[test]
    fn test_invalid_attestation_empty_fields() {
        // Test with empty public key
        let result = TeeAttestation::new(
            "sgx".to_string(),
            "".to_string(), // Empty public key
            base64::encode("test_report"),
            base64::encode("test_signature"),
            3600,
            None,
        );
        assert!(matches!(result, Err(TeeAttestationError::ConfigurationError)));

        // Test with empty report
        let result = TeeAttestation::new(
            "sgx".to_string(),
            base64::encode("test_public_key"),
            "".to_string(), // Empty report
            base64::encode("test_signature"),
            3600,
            None,
        );
        assert!(matches!(result, Err(TeeAttestationError::ConfigurationError)));

        // Test with empty signature
        let result = TeeAttestation::new(
            "sgx".to_string(),
            base64::encode("test_public_key"),
            base64::encode("test_report"),
            "".to_string(), // Empty signature
            3600,
            None,
        );
        assert!(matches!(result, Err(TeeAttestationError::ConfigurationError)));
    }

    #[test]
    fn test_supported_tee_types() {
        assert!(TeeAttestation::is_supported_tee_type("sgx"));
        assert!(TeeAttestation::is_supported_tee_type("sev"));
        assert!(TeeAttestation::is_supported_tee_type("trustzone"));
        assert!(TeeAttestation::is_supported_tee_type("asylo"));
        assert!(TeeAttestation::is_supported_tee_type("azure"));
        assert!(TeeAttestation::is_supported_tee_type("aws-nitro"));
        assert!(!TeeAttestation::is_supported_tee_type("unsupported"));
    }

    #[test]
    fn test_signature_verification() {
        let tee = TeeAttestation::new(
            "sgx".to_string(),
            base64::encode("test_public_key"),
            base64::encode("test_report"),
            base64::encode("test_signature"),
            3600,
            None,
        ).expect("Failed to create TEE attestation");

        // Test signature verification
        assert!(tee.verify_signature().is_ok());
        assert!(tee.verify_signature().unwrap());

        // Test data signature verification
        let data = b"test_data";
        let signature = base64::encode("test_data_signature");
        assert!(tee.verify_data_signature(data, &signature).is_ok());
        assert!(tee.verify_data_signature(data, &signature).unwrap());
    }

    #[test]
    fn test_sgx_attestation_validation() {
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
            3600,
            Some(metadata),
        ).expect("Failed to create TEE attestation");

        assert!(tee.validate_report().is_ok());

        // Test with invalid SGX metadata
        let invalid_metadata = json!({
            "invalid_field": "value"
        });

        let mut invalid_tee = tee.clone();
        invalid_tee.metadata = Some(invalid_metadata);
        assert!(invalid_tee.validate_report().is_err());
    }

    #[test]
    fn test_attestation_serialization() {
        let metadata = json!({
            "mrenclave": "abc123",
            "mrsigner": "def456",
        });

        let tee = TeeAttestation::new(
            "sgx".to_string(),
            base64::encode("test_public_key"),
            base64::encode("test_report"),
            base64::encode("test_signature"),
            3600,
            Some(metadata),
        ).expect("Failed to create TEE attestation");

        // Test JSON serialization
        let json = serde_json::to_string(&tee).unwrap();
        assert!(!json.is_empty());

        // Test JSON deserialization
        let deserialized: TeeAttestation = serde_json::from_str(&json).unwrap();
        assert_eq!(tee.tee_type, deserialized.tee_type);
        assert_eq!(tee.public_key, deserialized.public_key);
        assert_eq!(tee.attestation_id, deserialized.attestation_id);
    }

    #[test]
    fn test_getter_methods() {
        let tee = TeeAttestation::new(
            "sgx".to_string(),
            base64::encode("test_public_key"),
            base64::encode("test_report"),
            base64::encode("test_signature"),
            3600,
            None,
        ).expect("Failed to create TEE attestation");

        assert_eq!(tee.tee_type(), "sgx");
        assert!(!tee.public_key().is_empty());
        assert!(!tee.attestation_id().is_empty());
        assert!(tee.expires_at() > tee.timestamp);
    }
}
