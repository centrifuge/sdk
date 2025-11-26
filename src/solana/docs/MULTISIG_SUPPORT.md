# Multi-Sig Wallet Support for Solana Investments

## Overview

The Solana investment feature supports both **single-signature wallets** (Phantom, Solflare) and **multi-signature wallets** (Safe, Squads) through two different methods:

- **`invest()`** - For single-sig wallets with immediate execution
- **`prepareInvestTransaction()`** - For multi-sig wallets requiring approval collection

## Single-Sig vs Multi-Sig

### Single-Signature Wallets (Phantom, Solflare, etc.)

**Characteristics:**

- One private key controls the wallet
- Transactions are signed and sent immediately
- User approves in wallet popup
- Instant execution after approval

**Use the `invest()` method:**

```typescript
const { publicKey, signTransaction } = useWallet()
await solana.invest(amount, shareClassId, { publicKey, signTransaction })
```

### Multi-Signature Wallets (Safe, Squads)

**Characteristics:**

- Multiple signers control the wallet (e.g., 2-of-3, 3-of-5)
- Transactions require approval from multiple parties
- Proposal → Approvals → Execution flow
- Cannot execute immediately

**Use the `prepareInvestTransaction()` method:**

```typescript
const multiSigAddress = new PublicKey('...')
const tx = await solana.prepareInvestTransaction(amount, shareClassId, multiSigAddress)
// Submit to multi-sig program
```

## Using with Squads Multi-Sig

[Squads](https://squads.so/) is the most popular multi-sig solution on Solana.

### Installation

```bash
npm install @sqds/sdk
```

### Complete Example

```typescript
import { Centrifuge, Balance, ShareClassId } from '@centrifuge/sdk'
import { Squads } from '@sqds/sdk'
import { PublicKey } from '@solana/web3.js'

// Initialize SDK
const sdk = new Centrifuge({
  environment: 'mainnet',
  solana: {
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    commitment: 'confirmed',
  },
})

// Initialize Squads
const squads = new Squads({
  connection: sdk.solana!.connection,
})

// Multi-sig details
const multiSigAddress = new PublicKey('YourMultiSigAddress...')
const amount = Balance.fromFloat(10000, 6) // 10,000 USDC
const shareClassId = new ShareClassId('0x...')

// Step 1: Prepare the investment transaction
const pool = await sdk.pool(poolId)
const shareClass = await pool.shareClass(shareClassId)
const solanaInvest = shareClass.solana()

const transaction = await solanaInvest.prepareTransaction(amount, multiSigAddress)

// Step 2: Create proposal in Squads
const proposal = await squads.createProposal({
  multisigPda: multiSigAddress,
  transaction,
})

console.log('Proposal created:', proposal.publicKey.toBase58())
console.log('Share with other signers for approval')

// Step 3: Other signers approve the proposal (via Squads UI or SDK)
// const approval = await squads.approveProposal({
//   multisigPda: multiSigAddress,
//   proposalPda: proposal.publicKey,
// })

// Step 4: Once threshold is met, execute the proposal
// const execution = await squads.executeProposal({
//   multisigPda: multiSigAddress,
//   proposalPda: proposal.publicKey,
// })
```

## Using with Safe (Gnosis Safe on Solana)

If Safe launches on Solana, the pattern would be similar:

```typescript
import { SafeService } from '@safe-global/solana-sdk' // Hypothetical

const safe = new SafeService({
  connection: sdk.solana!.connection,
  safeAddress: safeAddress,
})

// Prepare transaction
const transaction = await solanaInvest.prepareTransaction(amount, safeAddress)

// Submit to Safe
const proposal = await safe.proposeTransaction({
  transaction,
  safeTxGas: 0,
  dataGas: 0,
  gasPrice: 0,
})

console.log('Safe proposal created:', proposal.safeTxHash)
```

## Frontend Integration Examples

### Detect Wallet Type

```typescript
import { useWallet } from '@solana/wallet-adapter-react'

function InvestComponent() {
  const { publicKey, signTransaction, wallet } = useWallet()
  const [isMultiSig, setIsMultiSig] = useState(false)

  useEffect(() => {
    // Check if connected wallet is a multi-sig
    if (publicKey) {
      checkIfMultiSig(publicKey).then(setIsMultiSig)
    }
  }, [publicKey])

  const checkIfMultiSig = async (address: PublicKey) => {
    // Check if address is a Squads multi-sig
    try {
      const squads = new Squads({ connection: sdk.solana.connection })
      const multisig = await squads.getMultisig(address)
      return multisig !== null
    } catch {
      return false
    }
  }

  const handleInvest = async () => {
    if (isMultiSig) {
      // Use multi-sig flow
      await handleMultiSigInvest()
    } else {
      // Use single-sig flow
      await handleSingleSigInvest()
    }
  }

  const handleSingleSigInvest = async () => {
    const amount = Balance.fromFloat(1000, 6)
    await solanaInvest.invest(amount, { publicKey, signTransaction })
    toast.success('Investment confirmed!')
  }

  const handleMultiSigInvest = async () => {
    const amount = Balance.fromFloat(1000, 6)
    const tx = await solanaInvest.prepareTransaction(amount, publicKey!)

    const squads = new Squads({ connection: sdk.solana.connection })
    const proposal = await squads.createProposal({
      multisigPda: publicKey,
      transaction: tx,
    })

    toast.success(`Proposal created: ${proposal.publicKey.toBase58()}`)
    toast.info('Share with other signers for approval')
  }

  return (
    <div>
      {isMultiSig && (
        <Badge>Multi-Sig Wallet</Badge>
      )}
      <button onClick={handleInvest}>
        {isMultiSig ? 'Create Investment Proposal' : 'Invest Now'}
      </button>
    </div>
  )
}
```

### Two-Button Approach

Alternatively, offer both options explicitly:

```typescript
function InvestComponent() {
  const { publicKey, signTransaction } = useWallet()

  return (
    <div>
      <h3>Choose Investment Method</h3>

      {/* Single-sig option */}
      <button onClick={handleDirectInvest}>
        Invest Now (Single Wallet)
      </button>

      {/* Multi-sig option */}
      <button onClick={handleMultiSigInvest}>
        Create Multi-Sig Proposal
      </button>
    </div>
  )
}
```

## API Reference

### `SolanaManager.prepareInvestTransaction()`

```typescript
async prepareInvestTransaction(
  amount: Balance,
  shareClassId: ShareClassId,
  fromAddress: PublicKey
): Promise<Transaction>
```

**Parameters:**

- `amount` - USDC amount with 6 decimals
- `shareClassId` - The share class ID to invest in
- `fromAddress` - The multi-sig address that will send USDC

**Returns:** Unsigned transaction ready for multi-sig submission

**Throws:** `SolanaTransactionError` on validation failure

### `SolanaInvestment.prepareTransaction()`

```typescript
async prepareTransaction(
  amount: Balance,
  fromAddress: PublicKey
): Promise<Transaction>
```

Convenience wrapper with share class ID already bound.

## Comparison: Single-Sig vs Multi-Sig

| Feature            | Single-Sig (`invest()`)     | Multi-Sig (`prepareInvestTransaction()`) |
| ------------------ | --------------------------- | ---------------------------------------- |
| **Execution**      | Immediate                   | Requires approvals first                 |
| **Signing**        | User signs in wallet popup  | Multiple parties approve                 |
| **Status Updates** | Observable with 5 stages    | Returns transaction only                 |
| **Confirmation**   | Auto-confirms after send    | Manual execution after approvals         |
| **Use Case**       | Individual investors        | DAOs, treasury management                |
| **Wallets**        | Phantom, Solflare, Backpack | Squads, Safe (if available)              |

## Multi-Sig Flow Diagram

```
┌──────────────────────────────────────────────────────────┐
│                    Single-Sig Flow                        │
└───��──────────────────────────────────────────────────────┘
invest() → Sign in Wallet → Send → Confirm → Done
         (1 approval)


┌──────────────────────────────────────────────────────────┐
│                    Multi-Sig Flow                         │
└──────────────────────────────────────────────────────────┘
prepareInvestTransaction() → Create Proposal  → Signer 1 Approves
                                              → Signer 2 Approves
                                              → ...
                                              → Threshold Met
                                              → Execute Proposal
                                              → Done
```

## Security Considerations

### Multi-Sig Benefits

1. **Distributed Control**: No single point of failure
2. **Approval Process**: Multiple parties review before execution
3. **Transparency**: All signers can see proposals
4. **Revocability**: Proposals can be rejected before execution

### Best Practices

1. **Verify Transaction**: Always inspect the transaction before approving
2. **Check Amount**: Verify USDC amount matches expectation
3. **Check Recipient**: Verify pool address is correct
4. **Timelock**: Consider adding timelock for large investments
5. **Audit Trail**: Keep records of all proposals and approvals

## Limitations

### What Multi-Sig DOESN'T Support

1. **No Real-Time Status**: Cannot track proposal approval status via Observable
2. **Manual Execution**: Requires someone to execute after threshold
3. **External Dependencies**: Relies on multi-sig program (Squads, etc.)
4. **Complexity**: More steps than single-sig flow

### Workarounds

**For status tracking**, poll the multi-sig program:

```typescript
async function pollProposalStatus(proposalPda: PublicKey) {
  const squads = new Squads({ connection: sdk.solana.connection })

  setInterval(async () => {
    const proposal = await squads.getProposal(proposalPda)
    console.log('Approvals:', proposal.approvals.length, '/', proposal.threshold)

    if (proposal.status === 'Executed') {
      console.log('Investment executed!')
      clearInterval()
    }
  }, 5000) // Poll every 5 seconds
}
```

## Troubleshooting

### "Invalid multisig account"

- Ensure the `fromAddress` is a valid multi-sig address
- Check that the multi-sig exists on the correct network (mainnet/devnet)

### "Transaction too old"

- Multi-sig proposals have expiration times
- Execute the proposal before the blockhash expires (~2 minutes on Solana)
- Consider using durable nonces for longer-lived transactions

### "Not enough approvals"

- Ensure enough signers have approved the proposal
- Check the multi-sig threshold requirement

### "Insufficient balance"

- The multi-sig's USDC account must have enough balance
- Transfer USDC to the multi-sig before creating proposal

## Related Resources

- [Squads Documentation](https://docs.squads.so/)
- [Squads SDK](https://github.com/Squads-Protocol/v4-sdk)
- [Solana Multi-Sig Guide](https://solana.com/developers/guides/advanced/multisig)
- [SDK Invest README](./INVEST_README.md)

## Future Enhancements

Potential improvements:

- Observable wrapper for proposal status tracking
- Automatic proposal execution when threshold is met
- Integration with Squads webhooks for notifications
- Support for batched multi-sig investments
- Time-weighted voting for multi-sig decisions
