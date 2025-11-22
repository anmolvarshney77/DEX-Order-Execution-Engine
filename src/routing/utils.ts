import { DexType } from '../types';

/**
 * Generate a realistic mock Solana transaction hash
 * Solana transaction signatures are base58-encoded and typically 88 characters long
 * 
 * @param _dex - The DEX that generated the transaction (for prefix identification)
 * @returns A mock transaction hash that looks like a real Solana signature
 */
export function generateMockTxHash(_dex: DexType): string {
  // Base58 alphabet (no 0, O, I, l to avoid confusion)
  const base58Chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  
  // Generate a 88-character base58 string
  let txHash = '';
  for (let i = 0; i < 88; i++) {
    const randomIndex = Math.floor(Math.random() * base58Chars.length);
    txHash += base58Chars[randomIndex];
  }
  
  // Add a timestamp-based component to ensure uniqueness
  const timestamp = Date.now().toString(36);
  
  // Replace a portion of the hash with timestamp to ensure uniqueness
  // while maintaining the 88-character length
  txHash = txHash.slice(0, 88 - timestamp.length) + timestamp;
  
  return txHash;
}

/**
 * Validate if a string looks like a valid Solana transaction hash
 * @param txHash - The transaction hash to validate
 * @returns True if the hash appears valid
 */
export function isValidTxHash(txHash: string): boolean {
  // Solana transaction signatures are typically 88 characters
  if (txHash.length !== 88) {
    return false;
  }
  
  // Check if it only contains base58 characters
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
  return base58Regex.test(txHash);
}
