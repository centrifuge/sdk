# ABI Maintenance Guide

This guide provides detailed procedures for updating contract ABIs in the Centrifuge SDK when the protocol contracts change.

**For quick reference, see the ABI update checklist in CLAUDE.md. This document provides the detailed procedures.**

---

## Table of Contents

1. [Overview](#overview)
2. [When to Update ABIs](#when-to-update-abis)
3. [Detailed Update Process](#detailed-update-process)
4. [Extracting ABIs](#extracting-abis)
5. [Converting JSON to Human-Readable Format](#converting-json-to-human-readable-format)
6. [Complete Examples](#complete-examples)
7. [Verification Steps](#verification-steps)
8. [Troubleshooting](#troubleshooting)

---

## Overview

The Centrifuge SDK uses **human-readable ABI format** (Viem/ethers style) stored in `src/abi/*.abi.ts` files. These ABIs are manually synchronized with the protocol repository when contracts change.

**Key Points:**

- No automated ABI validation exists (see `ABI_VALIDATION_ANALYSIS.md` for details)
- ABIs are extracted from deployed contracts or protocol compilation artifacts
- Human-readable format is more maintainable than JSON
- Only include functions/events/errors that SDK needs to interact with

---

## When to Update ABIs

Update ABIs when:

1. **Protocol releases new version** (e.g., v3.0 → v3.1)
2. **Contract deployments change** on any supported chain
3. **New functionality** needs to be exposed in SDK
4. **Breaking changes** occur in protocol contracts
5. **Bug fixes** modify contract interfaces

**Sources of Information:**

- Protocol repository releases: [github.com/centrifuge/protocol/releases](https://github.com/centrifuge/protocol/releases)
- Protocol PRs with "breaking" or "contract" labels
- Centrifuge developer communication channels
- Failed integration tests indicating ABI mismatch

---

## Detailed Update Process

### Step 1: Identify Changed Contracts

**Check Protocol Release Notes:**

```bash
# Clone or update protocol repository
git clone https://github.com/centrifuge/protocol.git
cd protocol

# Check recent releases and changes
git log --oneline --grep="contract" --grep="breaking" -i | head -20

# Check specific release
git show v3.1.0
```

**Review PR Descriptions:**

- Look for function signature changes
- Note new functions/events
- Identify deprecated functions
- Check for renamed contracts

**Common Contract Changes:**

- Added functions (new features)
- Modified function signatures (breaking changes)
- Removed functions (deprecated features)
- New events (tracking new behaviors)
- New error types (better error handling)

### Step 2: Extract New ABIs

You have two options for extracting ABIs:

#### Option A: From Deployed Contract (Recommended for Production)

**Most Reliable:** Ensures ABI matches what's actually deployed on-chain.

```bash
# Install Foundry if not already installed
# curl -L https://foundry.paradigm.xyz | bash
# foundryup

# Extract ABI from deployed contract
cast abi <contract-address> --rpc-url <rpc-url>

# Example: Extract Hub ABI from Sepolia
cast abi 0x6B1b1d1Ca52F8b5F8e38f8b6e6e1c5f4c8b0b8c4 \
  --rpc-url https://eth-sepolia.g.alchemy.com/v2/YOUR-KEY

# Save to file for processing
cast abi 0x6B1b1d1Ca52F8b5F8e38f8b6e6e1c5f4c8b0b8c4 \
  --rpc-url https://eth-sepolia.g.alchemy.com/v2/YOUR-KEY \
  > Hub.abi.json
```

**Get Contract Addresses:**

- Check protocol documentation
- Look in protocol repository's deployment scripts
- Query chain explorers (Etherscan, Basescan, etc.)
- Check previous commits in SDK for addresses

#### Option B: From Protocol Repository

**Good for Development:** Works before contracts are deployed.

```bash
cd protocol

# Build contracts with Foundry
forge build

# ABIs are in: out/<ContractName>.sol/<ContractName>.json
ls out/Hub.sol/

# Extract ABI field from JSON
cat out/Hub.sol/Hub.json | jq '.abi' > Hub.abi.json
```

**Finding Contract Files:**

```bash
# List all contract files
find src/contracts -name "*.sol"

# Find specific contract
find . -name "Hub.sol"

# After building, find output
find out/ -name "Hub.json"
```

### Step 3: Convert to Human-Readable Format

See [Converting JSON to Human-Readable Format](#converting-json-to-human-readable-format) section below for detailed conversion process.

**Quick Manual Conversion:**

JSON ABI:

```json
{
  "type": "function",
  "name": "updatePoolManagers",
  "inputs": [
    { "name": "poolId", "type": "bytes16" },
    { "name": "managers", "type": "address[]" },
    { "name": "permissions", "type": "bool[]" }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
}
```

Human-Readable:

```typescript
'function updatePoolManagers(bytes16 poolId, address[] managers, bool[] permissions)'
```

### Step 4: Update ABI Files

**Edit `src/abi/<ContractName>.abi.ts`:**

```typescript
// src/abi/Hub.abi.ts
export default [
  // ✅ Keep existing functions that SDK uses
  'function pool(bytes16 poolId) view returns (address)',

  // ✅ Add new functions
  'function newFeature(address user, uint256 amount) returns (bool)',

  // ✅ Update changed signatures
  'function updatePoolManagers(bytes16 poolId, address[] managers, bool[] permissions)', // Updated params

  // ❌ Remove deprecated functions (no longer on-chain)
  // 'function oldFunction() returns (bool)', // REMOVED

  // ✅ Add new events
  'event NewFeatureExecuted(address indexed user, uint256 amount)',

  // ✅ Add new errors
  'error InsufficientPermissions(address user)',
] as const
```

**Best Practices:**

- Only include functions/events SDK needs
- Group by category (view functions, state-changing, events, errors)
- Add comments for complex signatures
- Use indexed parameters in events
- Keep errors for proper error handling

### Step 5: Update `src/abi/index.ts` (If Adding New Contract)

```typescript
// src/abi/index.ts
import { parseAbi } from 'viem'

// Existing imports
import HubAbi from './Hub.abi.js'
import VaultRouterAbi from './VaultRouter.abi.js'

// New contract
import NewContractAbi from './NewContract.abi.js'

export const ABI = {
  Hub: parseAbi(HubAbi),
  VaultRouter: parseAbi(VaultRouterAbi),

  // Add new contract
  NewContract: parseAbi(NewContractAbi),
}
```

### Step 6: Update Entity Classes

**Add methods to expose new functionality:**

```typescript
// src/entities/Pool.ts
import { getContract } from 'viem'
import { ABI } from '../abi/index.js'

export class Pool extends Entity {
  // ... existing methods

  /**
   * New method to expose new contract function
   */
  async newFeature(amount: Balance) {
    return this._transact(function* () {
      const client = await this._root.getClient(this.centrifugeId)
      const { hub } = await this._root._protocolAddresses(this.centrifugeId)

      const hubContract = getContract({
        address: hub,
        abi: ABI.Hub,
        client,
      })

      const hash = yield* doTransaction(
        () => hubContract.write.newFeature([this.account.address, amount.toBigInt()]),
        MessageType.Submit
      )

      return { hash }
    })
  }
}
```

**Update existing methods if signatures changed:**

```typescript
// Before
async updatePoolManagers(poolId: string, managers: string[]) {
  // ...
}

// After (signature changed to add permissions parameter)
async updatePoolManagers(
  poolId: string,
  updates: Array<{ address: string; canManage: boolean }>
) {
  const managers = updates.map(u => u.address)
  const permissions = updates.map(u => u.canManage)

  // Use new contract signature
  return hubContract.write.updatePoolManagers([poolId, managers, permissions])
}
```

### Step 7: Update TypeScript Types (If Needed)

```typescript
// src/types/index.ts

// Add new types for new contract data
export interface NewFeatureData {
  user: string
  amount: bigint
  timestamp: number
}

// Update existing types if structures changed
export interface PoolDetails {
  // ... existing fields
  newField: string // Added in v3.1
}
```

### Step 8: Update Tests

**Add tests for new functionality:**

```typescript
// src/entities/Pool.test.ts
describe('Pool - New Feature', () => {
  it('should execute new feature', async () => {
    const amount = Balance.fromFloat(100, 6)
    const result = await pool.newFeature(amount)

    expect(result.hash).to.be.a('string')

    // Verify on-chain state changed
    const details = await pool.details()
    expect(details.newField).to.not.be.empty
  })

  it('should emit NewFeatureExecuted event', async () => {
    // Test event emission
  })

  it('should revert with InsufficientPermissions', async () => {
    // Test error condition
  })
})
```

**Update existing tests if behavior changed:**

```typescript
// Update test expectations if function behavior changed
it('should update pool managers with permissions', async () => {
  const updates = [
    { address: manager1, canManage: true },
    { address: manager2, canManage: false },
  ]

  const result = await pool.updatePoolManagers(updates)
  expect(result.type).to.equal('TransactionConfirmed')

  // Verify new permission structure
  const isManager1 = await pool.isPoolManager(manager1)
  expect(isManager1).to.be.true

  const isManager2 = await pool.isPoolManager(manager2)
  expect(isManager2).to.be.false
})
```

### Step 9: Run Full Test Suite

```bash
# Run all tests
pnpm test

# Run specific test file
pnpm test:single src/entities/Pool.test.ts

# Run with coverage
pnpm test:coverage

# Check build succeeds
pnpm build
```

### Step 10: Document Changes

**Update `PROTOCOL_VERSION.md` (create if doesn't exist):**

```markdown
# Protocol Version: v3.1.0

Last Updated: 2025-10-27
Protocol Commit: abc123def456
SDK Commit: xyz789ghi012

## Changed Contracts

### Hub

- Added `newFeature(address user, uint256 amount)` function
- Updated `updatePoolManagers` signature to include permissions
- Removed deprecated `oldFunction`

### VaultRouter

- No changes

## Breaking Changes

1. `updatePoolManagers` now requires permissions array
   - Old: `updatePoolManagers(poolId, managers[])`
   - New: `updatePoolManagers(poolId, managers[], permissions[])`
   - Migration: Add `permissions` array with `true` for all managers

## Deployment Addresses

### Mainnet (Chain ID: 1)

- Hub: 0x...
- VaultRouter: 0x...

### Sepolia (Chain ID: 11155111)

- Hub: 0x...
- VaultRouter: 0x...
```

**Update commit message:**

```bash
git add .
git commit -m "feat: update ABIs for protocol v3.1.0

- Update Hub ABI with newFeature function
- Update updatePoolManagers signature
- Add tests for new functionality
- Update entities to expose new methods

Protocol version: v3.1.0
Protocol commit: abc123def456

Breaking changes:
- updatePoolManagers requires permissions parameter

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Extracting ABIs

### Using Foundry Cast

```bash
# Basic extraction
cast abi <address> --rpc-url <rpc>

# With specific chain
cast abi 0x... --rpc-url https://mainnet.infura.io/v3/YOUR-KEY

# Save to file
cast abi 0x... --rpc-url <rpc> > output.json

# Extract specific function
cast abi <address> --rpc-url <rpc> | jq '.[] | select(.name=="functionName")'
```

### Using Etherscan API

```bash
# Fetch ABI via API
curl "https://api.etherscan.io/api?module=contract&action=getabi&address=0x...&apikey=YOUR-KEY"

# Parse response
curl "..." | jq -r '.result' | jq '.'
```

### Using Block Explorer UI

1. Go to contract on block explorer (Etherscan, Basescan, etc.)
2. Navigate to "Contract" tab
3. Scroll to "Contract ABI"
4. Copy JSON
5. Convert to human-readable format

---

## Converting JSON to Human-Readable Format

### Automated Conversion Script

Create `scripts/convert-abi.mjs`:

```javascript
#!/usr/bin/env node
import fs from 'fs'

const jsonAbi = JSON.parse(fs.readFileSync(process.argv[2], 'utf-8'))

const humanReadable = jsonAbi
  .filter((item) => ['function', 'event', 'error'].includes(item.type))
  .map((item) => {
    if (item.type === 'function') {
      const inputs = item.inputs.map((i) => `${i.type} ${i.name || ''}`).join(', ')
      const outputs = item.outputs?.length ? ` returns (${item.outputs.map((o) => o.type).join(', ')})` : ''
      const stateMutability = item.stateMutability !== 'nonpayable' ? ` ${item.stateMutability}` : ''
      return `'function ${item.name}(${inputs})${stateMutability}${outputs}'`
    }

    if (item.type === 'event') {
      const inputs = item.inputs
        .map((i) => {
          const indexed = i.indexed ? 'indexed ' : ''
          return `${i.type} ${indexed}${i.name || ''}`
        })
        .join(', ')
      return `'event ${item.name}(${inputs})'`
    }

    if (item.type === 'error') {
      const inputs = item.inputs?.map((i) => `${i.type} ${i.name || ''}`).join(', ') || ''
      return `'error ${item.name}(${inputs})'`
    }
  })
  .join(',\n  ')

const output = `export default [\n  ${humanReadable}\n] as const\n`

console.log(output)
```

**Usage:**

```bash
chmod +x scripts/convert-abi.mjs
./scripts/convert-abi.mjs Hub.abi.json > src/abi/Hub.abi.ts
```

### Manual Conversion Examples

**Function (View):**

```json
{
  "type": "function",
  "name": "balanceOf",
  "inputs": [{ "name": "owner", "type": "address" }],
  "outputs": [{ "type": "uint256" }],
  "stateMutability": "view"
}
```

→ `'function balanceOf(address owner) view returns (uint256)'`

**Function (State-Changing):**

```json
{
  "type": "function",
  "name": "transfer",
  "inputs": [
    { "name": "to", "type": "address" },
    { "name": "amount", "type": "uint256" }
  ],
  "outputs": [{ "type": "bool" }],
  "stateMutability": "nonpayable"
}
```

→ `'function transfer(address to, uint256 amount) returns (bool)'`

**Event:**

```json
{
  "type": "event",
  "name": "Transfer",
  "inputs": [
    { "name": "from", "type": "address", "indexed": true },
    { "name": "to", "type": "address", "indexed": true },
    { "name": "value", "type": "uint256", "indexed": false }
  ]
}
```

→ `'event Transfer(address indexed from, address indexed to, uint256 value)'`

**Error:**

```json
{
  "type": "error",
  "name": "InsufficientBalance",
  "inputs": [
    { "name": "available", "type": "uint256" },
    { "name": "required", "type": "uint256" }
  ]
}
```

→ `'error InsufficientBalance(uint256 available, uint256 required)'`

**Complex Function (Multiple Returns):**

```json
{
  "type": "function",
  "name": "investments",
  "inputs": [
    { "name": "vault", "type": "address" },
    { "name": "investor", "type": "address" }
  ],
  "outputs": [
    { "type": "uint128", "name": "maxMint" },
    { "type": "uint128", "name": "maxWithdraw" },
    { "type": "uint256", "name": "pendingDeposit" }
  ],
  "stateMutability": "view"
}
```

→ `'function investments(address vault, address investor) view returns (uint128 maxMint, uint128 maxWithdraw, uint256 pendingDeposit)'`

---

## Complete Examples

### Example 1: Adding New Function to Existing Contract

**Scenario:** Protocol adds `batchProcessRequests` to `AsyncRequestManager`.

**1. Update ABI:**

```typescript
// src/abi/AsyncRequestManager.abi.ts
export default [
  // ... existing functions
  'function batchProcessRequests(address[] vaults, address[] users) returns (bool)',
  'event BatchProcessed(address[] vaults, address[] users, uint256 timestamp)',
] as const
```

**2. Update Entity:**

```typescript
// src/entities/Vault.ts (or new entity if appropriate)
async batchProcess(users: string[]) {
  return this._transact(function* () {
    const client = await this._root.getClient(this.centrifugeId)
    const { asyncRequestManager } = await this._root._protocolAddresses(this.centrifugeId)

    const requestManager = getContract({
      address: asyncRequestManager,
      abi: ABI.AsyncRequests,
      client
    })

    const hash = yield* doTransaction(
      () => requestManager.write.batchProcessRequests([[this.address], users]),
      MessageType.Submit
    )

    return { hash }
  })
}
```

**3. Add Test:**

```typescript
// src/entities/Vault.test.ts
it('should batch process requests for multiple users', async () => {
  const users = [user1, user2, user3]

  const result = await vault.batchProcess(users)
  expect(result.hash).to.be.a('string')

  // Verify all users were processed
  for (const user of users) {
    const investment = await vault.investment(user)
    expect(investment.pendingInvestCurrency.toBigInt()).to.equal(0n)
  }
})
```

### Example 2: Handling Breaking Change

**Scenario:** `updatePoolManagers` signature changes from `(poolId, managers[])` to `(poolId, managers[], permissions[])`.

**1. Update ABI:**

```typescript
// src/abi/Hub.abi.ts
export default [
  // Old signature (commented for reference)
  // 'function updatePoolManagers(bytes16 poolId, address[] managers)',

  // New signature
  'function updatePoolManagers(bytes16 poolId, address[] managers, bool[] permissions)',
] as const
```

**2. Update Entity with Backward-Compatible API:**

```typescript
// src/entities/Pool.ts
async updatePoolManagers(
  updates: Array<{ address: string; canManage: boolean }>
) {
  return this._transact(function* () {
    const client = await this._root.getClient(this.centrifugeId)
    const { hub } = await this._root._protocolAddresses(this.centrifugeId)

    const hubContract = getContract({
      address: hub,
      abi: ABI.Hub,
      client
    })

    // Extract arrays for new signature
    const managers = updates.map(u => u.address)
    const permissions = updates.map(u => u.canManage)

    // Reorder: remove self at end (if present) to avoid permission issues
    const selfIndex = managers.findIndex(m =>
      m.toLowerCase() === this.account.address.toLowerCase()
    )
    if (selfIndex !== -1 && !permissions[selfIndex]) {
      managers.push(...managers.splice(selfIndex, 1))
      permissions.push(...permissions.splice(selfIndex, 1))
    }

    const hash = yield* doTransaction(
      () => hubContract.write.updatePoolManagers([
        this.id.raw,
        managers,
        permissions
      ]),
      MessageType.Submit
    )

    return { hash }
  })
}
```

**3. Update Tests:**

```typescript
// src/entities/Pool.test.ts
it('should update pool managers with specific permissions', async () => {
  const updates = [
    { address: newManager1, canManage: true },
    { address: newManager2, canManage: false }, // Remove permission
  ]

  const result = await pool.updatePoolManagers(updates)
  expect(result.type).to.equal('TransactionConfirmed')

  // Verify permissions
  expect(await pool.isPoolManager(newManager1)).to.be.true
  expect(await pool.isPoolManager(newManager2)).to.be.false
})
```

**4. Document Breaking Change:**

````markdown
## Migration Guide: v3.0 to v3.1

### Breaking Changes

#### `Pool.updatePoolManagers()` signature changed

**Before:**

```typescript
await pool.updatePoolManagers(poolId, [address1, address2])
```
````

**After:**

```typescript
await pool.updatePoolManagers([
  { address: address1, canManage: true },
  { address: address2, canManage: true },
])
```

To remove a manager:

```typescript
await pool.updatePoolManagers([{ address: existingManager, canManage: false }])
```

````

### Example 3: Adding Completely New Contract

**Scenario:** Protocol adds new `BatchRequestManager` contract.

**1. Create ABI File:**
```typescript
// src/abi/BatchRequestManager.abi.ts
export default [
  'function batchRequest(address[] vaults, uint256[] amounts) returns (bool)',
  'function cancelBatchRequest(bytes32 requestId) returns (bool)',
  'function claimBatchRequest(bytes32 requestId) returns (uint256[])',
  'event BatchRequestCreated(bytes32 indexed requestId, address[] vaults, uint256[] amounts)',
  'event BatchRequestCancelled(bytes32 indexed requestId)',
  'error InvalidBatchRequest()',
] as const
````

**2. Add to ABI Index:**

```typescript
// src/abi/index.ts
import BatchRequestManagerAbi from './BatchRequestManager.abi.js'

export const ABI = {
  // ... existing
  BatchRequestManager: parseAbi(BatchRequestManagerAbi),
}
```

**3. Create Entity (if complex enough):**

```typescript
// src/entities/BatchRequestManager.ts
export class BatchRequestManager extends Entity {
  constructor(
    _root: Centrifuge,
    public pool: Pool,
    public centrifugeId: number
  ) {
    super(_root, ['batch-request-manager', pool.id.toString(), centrifugeId.toString()])
  }

  async batchRequest(vaults: Vault[], amounts: Balance[]) {
    // Implementation
  }

  async cancelBatchRequest(requestId: string) {
    // Implementation
  }

  async claimBatchRequest(requestId: string) {
    // Implementation
  }
}
```

**4. Export from Index:**

```typescript
// src/index.ts
export * from './entities/BatchRequestManager.js'
```

**5. Add Tests:**

```typescript
// src/entities/BatchRequestManager.test.ts
describe('BatchRequestManager', () => {
  let manager: BatchRequestManager

  before(async () => {
    const pool = await centrifuge.pool(poolId)
    manager = new BatchRequestManager(centrifuge, pool, centrifugeId)
  })

  it('should create batch request', async () => {
    // Test implementation
  })

  it('should cancel batch request', async () => {
    // Test implementation
  })

  it('should claim batch request', async () => {
    // Test implementation
  })
})
```

---

## Verification Steps

After completing ABI updates, verify:

### 1. Compilation Check

```bash
pnpm build
# Should complete without errors
```

### 2. Type Safety Check

```bash
npx tsc --noEmit
# Should show no type errors
```

### 3. Test Execution

```bash
# Run all tests
pnpm test

# Run specific entity tests
pnpm test:single src/entities/Pool.test.ts

# Check coverage
pnpm test:coverage
```

### 4. Contract Verification (Manual)

```typescript
// Create verification script: scripts/verify-abis.ts
import { createPublicClient, http, getContract } from 'viem'
import { mainnet } from 'viem/chains'
import { ABI } from '../src/abi/index.js'

const client = createPublicClient({
  chain: mainnet,
  transport: http('https://eth-mainnet.g.alchemy.com/v2/YOUR-KEY')
})

const hubAddress = '0x...' // From protocol config

const hub = getContract({
  address: hubAddress,
  abi: ABI.Hub,
  client
})

try {
  // Try calling a view function
  const result = await hub.read.someFunction([...])
  console.log('✅ ABI is valid, function call succeeded')
} catch (error) {
  console.error('❌ ABI mismatch or function doesn't exist:', error)
}
```

Run verification:

```bash
npx tsx scripts/verify-abis.ts
```

### 5. Integration Test on Tenderly Fork

```bash
# Run integration tests with Tenderly
pnpm test

# Check specific functionality
pnpm test:single src/entities/Pool.test.ts

# Keep fork alive for debugging
DEBUG=true pnpm test:single src/entities/Pool.test.ts
```

### 6. Check Against Deployed Contract

```bash
# Get deployed ABI
cast abi <address> --rpc-url <rpc> > deployed.json

# Compare with SDK ABI (manual review)
# Look for:
# - Missing functions in SDK
# - Extra functions in SDK (now deprecated)
# - Signature mismatches
```

---

## Troubleshooting

### Issue: Build Fails with "Parse Error"

**Cause:** Syntax error in ABI string.

**Solution:**

```typescript
// ❌ WRONG: Missing quotes, parentheses
'function transfer(address to, uint256 amount'

// ✅ CORRECT: Proper syntax
'function transfer(address to, uint256 amount) returns (bool)'
```

### Issue: Type Error "Property does not exist"

**Cause:** Function not added to ABI or typo in function name.

**Solution:**

```typescript
// Check ABI includes the function
export default [
  'function myFunction(...)', // Must be present
]

// Check spelling in code
contract.read.myFunction([...]) // Must match exactly
```

### Issue: Transaction Reverts with "Function not found"

**Cause:** ABI function doesn't exist on deployed contract.

**Solution:**

1. Verify contract address is correct
2. Check contract is deployed (has bytecode)
3. Verify function exists in deployed contract:
   ```bash
   cast abi <address> --rpc-url <rpc> | grep "functionName"
   ```

### Issue: Decoding Error on Function Call

**Cause:** Return types don't match actual contract.

**Solution:**

```typescript
// ❌ WRONG: Returns wrong type
'function getAmount() view returns (uint128)'

// ✅ CORRECT: Match actual contract
'function getAmount() view returns (uint256)'
```

Check actual return type:

```bash
cast call <address> "getAmount()" --rpc-url <rpc>
```

### Issue: Tests Pass but Production Fails

**Cause:** Tenderly fork may have different contract version than production.

**Solution:**

1. Verify contract addresses match production
2. Check deployed contract bytecode
3. Test against mainnet fork, not testnet
4. Update test data to match production state

### Issue: Git Merge Conflicts in ABI Files

**Cause:** Multiple developers updating same ABI.

**Solution:**

1. Communicate ABI updates with team
2. Resolve conflicts by taking newest version
3. Re-run tests after merge
4. Verify both features work after merge

---

## Best Practices

1. **Always verify ABIs against deployed contracts** before merging
2. **Test thoroughly** - both unit and integration tests
3. **Document breaking changes** in commit messages and PROTOCOL_VERSION.md
4. **Update incrementally** - don't update all ABIs at once unless necessary
5. **Keep ABIs minimal** - only include functions SDK needs
6. **Use semantic versioning** - major version for breaking changes
7. **Coordinate with protocol team** - know about changes in advance
8. **Maintain backward compatibility** when possible
9. **Add deprecation warnings** before removing functions
10. **Create migration guides** for breaking changes

---

## Additional Resources

- **ABI Validation Analysis:** See `ABI_VALIDATION_ANALYSIS.md` for detailed analysis of validation gaps
- **Protocol Repository:** [github.com/centrifuge/protocol](https://github.com/centrifuge/protocol)
- **Viem Documentation:** [viem.sh](https://viem.sh) - ABI utilities and contract interaction
- **Foundry Documentation:** [book.getfoundry.sh](https://book.getfoundry.sh) - Cast commands
- **SDK Tests:** Review `src/entities/*.test.ts` for working examples

---

**Last Updated:** 2025-10-27
**Maintained By:** Centrifuge SDK Team
