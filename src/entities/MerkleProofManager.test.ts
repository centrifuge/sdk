import { expect } from 'chai'
import { of } from 'rxjs'
import sinon from 'sinon'
import { encodePacked } from 'viem'
import { ABI } from '../abi/index.js'
import { Centrifuge } from '../Centrifuge.js'
import { HexString } from '../index.js'
import { context } from '../tests/setup.js'
import { randomAddress } from '../tests/utils.js'
import { MerkleProofPolicy, MerkleProofPolicyInput, MerkleProofWorkflow } from '../types/poolMetadata.js'
import { makeThenable } from '../utils/rx.js'
import { PoolId, ShareClassId } from '../utils/types.js'
import {
  findWorkflowPolicyIndices,
  isVerifiedWorkflow,
  MerkleProofManager,
} from './MerkleProofManager.js'
import { Pool } from './Pool.js'
import { PoolNetwork } from './PoolNetwork.js'

const chainId = 11155111
const centId = 1

const poolId = PoolId.from(centId, 1)
const scId = ShareClassId.from(poolId, 1)

const someErc20 = '0x3aaaa86458d576BafCB1B7eD290434F0696dA65c'

const fundManager = '0x423420Ae467df6e90291fd0252c0A8a637C1e03f'
const mpmAddress = '0x9E5FD1A9D960d8CfA76Ad1dd2F5D8FEeB5bdD382'
const vaultDecoder = '0x8E5bE47D081F53033eb7C9DB3ad31BaF67F15585'

describe('MerkleProofManager', () => {
  let pool: Pool
  let merkleProofManager: MerkleProofManager
  let mockPolicies: MerkleProofPolicy[]
  let randomUser: HexString
  const strategist = randomAddress()
  before(async () => {
    const { centrifuge } = context
    const { balanceSheet, vaultRouter } = await centrifuge._protocolAddresses(centId)
    pool = new Pool(centrifuge, poolId.raw)
    const poolNetwork = new PoolNetwork(centrifuge, pool, centId)
    merkleProofManager = new MerkleProofManager(centrifuge, poolNetwork, mpmAddress)
    const decoder = vaultDecoder
    const target = balanceSheet
    randomUser = randomAddress()

    mockPolicies = [
      {
        decoder,
        target: someErc20,
        targetName: 'Some ERC20 Token',
        name: 'Approve spending',
        selector: 'function approve(address,uint256)',
        valueNonZero: false,
        inputs: [
          {
            parameter: 'address',
            label: 'Vault Router',
            input: [vaultRouter],
          },
          {
            parameter: 'uint256',
            label: 'Amount',
            input: [],
          },
        ],
        inputCombinations: [
          {
            inputs: [vaultRouter, null],
            inputsEncoded: encodePacked(['address'], [vaultRouter]),
          },
        ],
      },
      {
        decoder,
        target,
        selector: 'function cancelDepositRequest(uint256, address controller)',
        valueNonZero: false,
        inputs: [
          {
            parameter: 'uint256',
            input: [],
          },
          {
            parameter: 'address',
            input: [randomUser],
          },
        ],
        inputCombinations: [
          {
            inputs: [null, randomUser],
            inputsEncoded: encodePacked(['address'], [randomUser]),
          },
        ],
      },
      {
        decoder,
        target,
        selector: 'function cancelRedeemRequest(uint256, address controller)',
        valueNonZero: false,
        inputs: [
          {
            parameter: 'uint256',
            input: [],
          },
          {
            parameter: 'address',
            input: [randomUser],
          },
        ],
        inputCombinations: [
          {
            inputs: [null, randomUser],
            inputsEncoded: encodePacked(['address'], [randomUser]),
          },
        ],
      },
      {
        decoder,
        target,
        selector: 'function claimCancelDepositRequest(uint256, address receiver, address controller)',
        valueNonZero: false,
        inputs: [
          {
            parameter: 'uint256',
            input: [],
          },
          {
            parameter: 'address receiver',
            input: [randomUser],
          },
          {
            parameter: 'address controller',
            input: [randomUser],
          },
        ],
        inputCombinations: [
          {
            inputs: [null, randomUser, randomUser],
            inputsEncoded: encodePacked(['address', 'address'], [randomUser, randomUser]),
          },
        ],
      },
      {
        decoder,
        target,
        selector: 'function claimCancelRedeemRequest(uint256, address receiver, address controller)',
        valueNonZero: false,
        inputs: [
          {
            parameter: 'uint256',
            input: [],
          },
          {
            parameter: 'address receiver',
            input: [randomUser],
          },
          {
            parameter: 'address controller',
            input: [randomUser],
          },
        ],
        inputCombinations: [
          {
            inputs: [null, randomUser, randomUser],
            inputsEncoded: encodePacked(['address', 'address'], [randomUser, randomUser]),
          },
        ],
      },
      {
        decoder,
        target,
        selector: 'function deposit(uint64 poolId, bytes16 scId, address asset, uint256, uint128)',
        valueNonZero: false,
        inputs: [
          {
            parameter: 'poolId',
            input: [poolId.toString() as HexString],
          },
          {
            parameter: 'shareClassId',
            input: [scId.raw],
          },
          {
            parameter: 'erc20',
            input: [someErc20],
          },
          {
            parameter: 'uint256',
            input: [],
          },
          {
            parameter: 'uint128',
            input: [],
          },
        ],
        inputCombinations: [
          {
            inputs: [poolId.toString() as HexString, scId.raw, someErc20, null, null],
            inputsEncoded: encodePacked(['uint64', 'bytes16', 'address'], [poolId.raw, scId.raw, someErc20]),
          },
        ],
      },
      {
        decoder,
        target,
        selector: 'function deposit(uint256, address receiver)',
        valueNonZero: false,
        inputs: [
          {
            parameter: 'uint256',
            input: [],
          },
          {
            parameter: 'address',
            input: [randomUser],
          },
        ],
        inputCombinations: [
          {
            inputs: [null, randomUser],
            inputsEncoded: encodePacked(['address'], [randomUser]),
          },
        ],
      },
      {
        decoder,
        target,
        selector: 'function mint(uint256, address receiver)',
        valueNonZero: false,
        inputs: [
          {
            parameter: 'uint256',
            input: [],
          },
          {
            parameter: 'address',
            input: [randomUser],
          },
        ],
        inputCombinations: [
          {
            inputs: [null, randomUser],
            inputsEncoded: encodePacked(['address'], [randomUser]),
          },
        ],
      },
      {
        decoder,
        target,
        selector: 'function redeem(uint256, address receiver, address owner)',
        valueNonZero: false,
        inputs: [
          {
            parameter: 'uint256',
            input: [],
          },
          {
            parameter: 'address receiver',
            input: [randomUser],
          },
          {
            parameter: 'address controller',
            input: [randomUser],
          },
        ],
        inputCombinations: [
          {
            inputs: [null, randomUser, randomUser],
            inputsEncoded: encodePacked(['address', 'address'], [randomUser, randomUser]),
          },
        ],
      },
      {
        decoder,
        target,
        selector: 'function requestDeposit(uint256, address controller, address owner)',
        valueNonZero: false,
        inputs: [
          {
            parameter: 'uint256',
            input: [],
          },
          {
            parameter: 'address receiver',
            input: [randomUser],
          },
          {
            parameter: 'address controller',
            input: [randomUser],
          },
        ],
        inputCombinations: [
          {
            inputs: [null, randomUser, randomUser],
            inputsEncoded: encodePacked(['address', 'address'], [randomUser, randomUser]),
          },
        ],
      },
      {
        decoder,
        target,
        selector: 'function requestRedeem(uint256, address controller, address owner)',
        valueNonZero: false,
        inputs: [
          {
            parameter: 'uint256',
            input: [],
          },
          {
            parameter: 'address receiver',
            input: [randomUser],
          },
          {
            parameter: 'address controller',
            input: [randomUser],
          },
        ],
        inputCombinations: [
          {
            inputs: [null, randomUser, randomUser],
            inputsEncoded: encodePacked(['address', 'address'], [randomUser, randomUser]),
          },
        ],
      },
      {
        decoder,
        target,
        selector: 'function withdraw(uint256, address receiver, address owner)',
        valueNonZero: false,
        inputs: [
          {
            parameter: 'uint256',
            input: [],
          },
          {
            parameter: 'address receiver',
            input: [randomUser],
          },
          {
            parameter: 'address controller',
            input: [randomUser],
          },
        ],
        inputCombinations: [
          {
            inputs: [null, randomUser, randomUser],
            inputsEncoded: encodePacked(['address', 'address'], [randomUser, randomUser]),
          },
        ],
      },
      {
        decoder,
        target,
        selector: 'function withdraw(uint64,bytes16,address,uint256,address,uint128)',
        valueNonZero: false,
        inputs: [
          {
            parameter: 'poolId',
            input: [poolId.toString() as HexString],
          },
          {
            parameter: 'shareClassId',
            input: [scId.raw],
          },
          {
            parameter: 'erc20',
            input: [someErc20],
          },
          {
            parameter: 'uint256',
            input: [],
          },
          {
            parameter: 'address',
            input: [randomUser],
          },
          {
            parameter: 'uint128',
            input: [],
          },
        ],
        inputCombinations: [
          {
            inputs: [poolId.toString() as HexString, scId.raw, someErc20, null, randomUser, null],
            inputsEncoded: encodePacked(
              ['uint64', 'bytes16', 'address', 'address'],
              [poolId.raw, scId.raw, someErc20, randomUser]
            ),
          },
        ],
      },
    ]

    context.tenderlyFork.impersonateAddress = fundManager
    context.centrifuge.setSigner(context.tenderlyFork.signer)

    await pool.updateBalanceSheetManagers([{ centrifugeId: centId, address: mpmAddress, canManage: true }])
  })

  it('sets workflows', async () => {
    const centrifugeWithPin = new Centrifuge({
      environment: 'testnet',
      pinJson: async (data) => {
        expect(data.merkleProofManager[chainId][strategist].workflows).to.have.length(1)
        return 'abc'
      },
      rpcUrls: {
        11155111: context.tenderlyFork.rpcUrl,
      },
    })
    const mpm = new MerkleProofManager(centrifugeWithPin, merkleProofManager.network, mpmAddress)

    context.tenderlyFork.impersonateAddress = fundManager
    centrifugeWithPin.setSigner(context.tenderlyFork.signer)

    const workflow: MerkleProofWorkflow = {
      id: 'workflow-1',
      name: 'Default Workflow',
      template: 'erc7540_requestDeposit',
      category: 'Allocation',
      iconUrl: 'ipfs://icon',
      isVerified: false,
      actions: [
        { policyIndex: 0, defaultValues: ['0x', 987654321000] },
        { policyIndex: 1, defaultValues: [987654321000, '0x'] },
      ],
      createdAt: new Date().toISOString(),
    }

    await mpm.setWorkflows(strategist, [workflow])
  })

  it('addWorkflow reuses existing strategist policies and stores a verified workflow only', async () => {
    let pinnedMetadata: any
    const centrifugeWithPin = new Centrifuge({
      environment: 'testnet',
      pinJson: async (data) => {
        pinnedMetadata = data
        return 'abc'
      },
      rpcUrls: {
        11155111: context.tenderlyFork.rpcUrl,
      },
    })
    const mpm = new MerkleProofManager(centrifugeWithPin, merkleProofManager.network, mpmAddress)

    context.tenderlyFork.impersonateAddress = fundManager
    centrifugeWithPin.setSigner(context.tenderlyFork.signer)

    const details = await mpm.pool.details()
    const detailsStub = sinon.stub(mpm.pool, 'details')
    detailsStub.resolves({
      ...details,
      metadata: {
        ...details.metadata,
        merkleProofManager: {
          ...details.metadata?.merkleProofManager,
          [chainId]: {
            ...details.metadata?.merkleProofManager?.[chainId],
            [strategist.toLowerCase()]: {
              policies: [mockPolicies[0]!, mockPolicies[1]!],
              workflows: [],
            },
          },
        },
      },
    } as any)

    const verificationActions = [
      {
        policy: {
          decoder: mockPolicies[0]!.decoder,
          target: mockPolicies[0]!.target,
          targetName: mockPolicies[0]!.targetName,
          name: mockPolicies[0]!.name,
          selector: mockPolicies[0]!.selector,
          valueNonZero: mockPolicies[0]!.valueNonZero,
          inputs: mockPolicies[0]!.inputs,
        },
        defaultValues: [mockPolicies[0]!.inputs[0]!.input[0]!, null],
      },
      {
        policy: {
          decoder: mockPolicies[1]!.decoder,
          target: mockPolicies[1]!.target,
          targetName: mockPolicies[1]!.targetName,
          name: mockPolicies[1]!.name,
          selector: mockPolicies[1]!.selector,
          valueNonZero: mockPolicies[1]!.valueNonZero,
          inputs: mockPolicies[1]!.inputs,
        },
        defaultValues: [null, randomUser],
      },
    ]

    await mpm.addWorkflow(strategist, {
      id: 'marketplace-workflow',
      name: 'Marketplace workflow',
      template: 'erc7540_requestDeposit',
      category: 'Allocation',
      iconUrl: 'ipfs://icon',
      verificationActions,
    })

    const stored = pinnedMetadata.merkleProofManager[chainId][strategist.toLowerCase()]
    expect(stored.policies).to.deep.equal([mockPolicies[0]!, mockPolicies[1]!])
    expect(stored.workflows).to.have.length(1)
    expect(stored.workflows[0]!.actions).to.deep.equal([
      { policyIndex: 0, defaultValues: [mockPolicies[0]!.inputs[0]!.input[0]!, null] },
      { policyIndex: 1, defaultValues: [null, randomUser] },
    ])
    expect(stored.workflows[0]!.isVerified).to.equal(true)

    detailsStub.restore()
  })

  describe('isVerifiedWorkflow', () => {
    it('returns true for exact policy and default-values match', () => {
      const policyInput: MerkleProofPolicyInput = {
        decoder: mockPolicies[0]!.decoder,
        target: mockPolicies[0]!.target,
        targetName: mockPolicies[0]!.targetName,
        name: mockPolicies[0]!.name,
        selector: mockPolicies[0]!.selector,
        valueNonZero: mockPolicies[0]!.valueNonZero,
        inputs: mockPolicies[0]!.inputs,
      }
      const workflow: MerkleProofWorkflow = {
        id: 'workflow-1',
        name: 'Workflow',
        createdAt: new Date().toISOString(),
        actions: [
          {
            policyIndex: 0,
            defaultValues: [mockPolicies[0]!.inputs[0]!.input[0]!, null],
          },
        ],
      }

      expect(
        isVerifiedWorkflow(
          workflow,
          [mockPolicies[0]!],
          [
            {
              policy: policyInput,
              defaultValues: [mockPolicies[0]!.inputs[0]!.input[0]!, null],
            },
          ]
        )
      ).to.equal(true)
    })

    it('returns false when action order differs', () => {
      const workflow: MerkleProofWorkflow = {
        id: 'workflow-2',
        name: 'Workflow',
        createdAt: new Date().toISOString(),
        actions: [
          {
            policyIndex: 0,
            defaultValues: [mockPolicies[0]!.inputs[0]!.input[0]!, null],
          },
          {
            policyIndex: 1,
            defaultValues: [null, randomUser],
          },
        ],
      }

      const canonicalActions: MerkleProofPolicyInput[] = [
        {
          decoder: mockPolicies[1]!.decoder,
          target: mockPolicies[1]!.target,
          targetName: mockPolicies[1]!.targetName,
          name: mockPolicies[1]!.name,
          selector: mockPolicies[1]!.selector,
          valueNonZero: mockPolicies[1]!.valueNonZero,
          inputs: mockPolicies[1]!.inputs,
        },
        {
          decoder: mockPolicies[0]!.decoder,
          target: mockPolicies[0]!.target,
          targetName: mockPolicies[0]!.targetName,
          name: mockPolicies[0]!.name,
          selector: mockPolicies[0]!.selector,
          valueNonZero: mockPolicies[0]!.valueNonZero,
          inputs: mockPolicies[0]!.inputs,
        },
      ]

      expect(
        isVerifiedWorkflow(
          workflow,
          [mockPolicies[0]!, mockPolicies[1]!],
          [
            { policy: canonicalActions[0]!, defaultValues: [null, randomUser] },
            { policy: canonicalActions[1]!, defaultValues: [mockPolicies[0]!.inputs[0]!.input[0]!, null] },
          ]
        )
      ).to.equal(false)
    })

    it('returns false when policy structure differs', () => {
      const policyInput: MerkleProofPolicyInput = {
        decoder: mockPolicies[0]!.decoder,
        target: randomAddress(),
        targetName: mockPolicies[0]!.targetName,
        name: mockPolicies[0]!.name,
        selector: mockPolicies[0]!.selector,
        valueNonZero: mockPolicies[0]!.valueNonZero,
        inputs: mockPolicies[0]!.inputs,
      }
      const workflow: MerkleProofWorkflow = {
        id: 'workflow-3',
        name: 'Workflow',
        createdAt: new Date().toISOString(),
        actions: [
          {
            policyIndex: 0,
            defaultValues: [mockPolicies[0]!.inputs[0]!.input[0]!, null],
          },
        ],
      }

      expect(
        isVerifiedWorkflow(
          workflow,
          [mockPolicies[0]!],
          [{ policy: policyInput, defaultValues: [mockPolicies[0]!.inputs[0]!.input[0]!, null] }]
        )
      ).to.equal(false)
    })

    it('returns false when default-values differ', () => {
      const policyInput: MerkleProofPolicyInput = {
        decoder: mockPolicies[0]!.decoder,
        target: mockPolicies[0]!.target,
        targetName: mockPolicies[0]!.targetName,
        name: mockPolicies[0]!.name,
        selector: mockPolicies[0]!.selector,
        valueNonZero: mockPolicies[0]!.valueNonZero,
        inputs: mockPolicies[0]!.inputs,
      }
      const workflow: MerkleProofWorkflow = {
        id: 'workflow-4',
        name: 'Workflow',
        createdAt: new Date().toISOString(),
        actions: [
          {
            policyIndex: 0,
            defaultValues: [mockPolicies[0]!.inputs[0]!.input[0]!, null],
          },
        ],
      }

      expect(
        isVerifiedWorkflow(
          workflow,
          [mockPolicies[0]!],
          [{ policy: policyInput, defaultValues: [mockPolicies[0]!.inputs[0]!.input[0]!, 123] }]
        )
      ).to.equal(false)
    })

    it('returns false when default-values are not positional', () => {
      const policyInput: MerkleProofPolicyInput = {
        decoder: mockPolicies[0]!.decoder,
        target: mockPolicies[0]!.target,
        targetName: mockPolicies[0]!.targetName,
        name: mockPolicies[0]!.name,
        selector: mockPolicies[0]!.selector,
        valueNonZero: mockPolicies[0]!.valueNonZero,
        inputs: mockPolicies[0]!.inputs,
      }
      const workflow: MerkleProofWorkflow = {
        id: 'workflow-5',
        name: 'Workflow',
        createdAt: new Date().toISOString(),
        actions: [
          {
            policyIndex: 0,
            defaultValues: [mockPolicies[0]!.inputs[0]!.input[0]!],
          },
        ],
      }

      expect(
        isVerifiedWorkflow(
          workflow,
          [mockPolicies[0]!],
          [{ policy: policyInput, defaultValues: [mockPolicies[0]!.inputs[0]!.input[0]!, null] }]
        )
      ).to.equal(false)
    })
  })

  describe('findWorkflowPolicyIndices', () => {
    it('returns matching policy indices for canonical actions', () => {
      expect(
        findWorkflowPolicyIndices([mockPolicies[0]!, mockPolicies[1]!], [
          {
            policy: {
              decoder: mockPolicies[1]!.decoder,
              target: mockPolicies[1]!.target,
              targetName: mockPolicies[1]!.targetName,
              name: mockPolicies[1]!.name,
              selector: mockPolicies[1]!.selector,
              valueNonZero: mockPolicies[1]!.valueNonZero,
              inputs: mockPolicies[1]!.inputs,
            },
            defaultValues: [null, randomUser],
          },
          {
            policy: {
              decoder: mockPolicies[0]!.decoder,
              target: mockPolicies[0]!.target,
              targetName: mockPolicies[0]!.targetName,
              name: mockPolicies[0]!.name,
              selector: mockPolicies[0]!.selector,
              valueNonZero: mockPolicies[0]!.valueNonZero,
              inputs: mockPolicies[0]!.inputs,
            },
            defaultValues: [mockPolicies[0]!.inputs[0]!.input[0]!, null],
          },
        ])
      ).to.deep.equal([1, 0])
    })

    it('returns null when one of the canonical actions is missing', () => {
      expect(
        findWorkflowPolicyIndices([mockPolicies[0]!], [
          {
            policy: {
              decoder: mockPolicies[1]!.decoder,
              target: mockPolicies[1]!.target,
              targetName: mockPolicies[1]!.targetName,
              name: mockPolicies[1]!.name,
              selector: mockPolicies[1]!.selector,
              valueNonZero: mockPolicies[1]!.valueNonZero,
              inputs: mockPolicies[1]!.inputs,
            },
            defaultValues: [null, randomUser],
          },
        ])
      ).to.equal(null)
    })
  })

})
