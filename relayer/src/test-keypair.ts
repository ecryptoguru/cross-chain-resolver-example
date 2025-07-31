import { KeyPair } from '@near-js/crypto';

// Log the KeyPair class to inspect its methods
console.log('KeyPair methods:', Object.getOwnPropertyNames(KeyPair).filter(prop => typeof (KeyPair as any)[prop] === 'function'));

// Try to create a key pair from a test private key (ed25519 format)
try {
  const keyPair = KeyPair.fromString('ed25519:5yARProkcALbxaKU266EYiSzdisCCCiWYHTaA68q4NvVmjmDgdrFzrvFpCKYXN4pCzWGSFSxvcDdVh7FFMuHfCFT');
  console.log('KeyPair created successfully:', keyPair);
} catch (error) {
  console.error('Error creating KeyPair:', error);
}
