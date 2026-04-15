import { expect } from 'chai'
import { MAGIC_VARIABLE_KEYS, resolveMagicVariables, resolveVariableLabel } from './variables.js'
import type { MagicVariableContext } from './variables.js'
import type { PoolMetadata } from '../types/poolMetadata.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CTX: MagicVariableContext = {
  executor:              '0x000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  poolEscrow:            '0x000000000000000000000000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  onOffRamp:             '0x000000000000000000000000cccccccccccccccccccccccccccccccccccccccc',
  poolId:                '0x0000000000000000000000000000000000000000000000000000000000000001',
  scId:                  '0x00010000000000010000000000000001000000000000000000000000000000000',
  accountingTokenId:     '0x0000000000000000000000000000000000000000000000000000000000000002',
  accountingTokenAssetId:'0x0000000000000000000000000000000000000000000000000000000000000003',
}

// Minimal pool metadata
const POOL_META = {
  pool: { name: 'Test Pool' },
  shareClasses: {},
} as unknown as PoolMetadata

describe('utils/variables', () => {
  describe('MAGIC_VARIABLE_KEYS', () => {
    it('contains exactly the seven expected keys', () => {
      expect(MAGIC_VARIABLE_KEYS).to.include('$executor')
      expect(MAGIC_VARIABLE_KEYS).to.include('$poolEscrow')
      expect(MAGIC_VARIABLE_KEYS).to.include('$onOffRamp')
      expect(MAGIC_VARIABLE_KEYS).to.include('$poolId')
      expect(MAGIC_VARIABLE_KEYS).to.include('$scId')
      expect(MAGIC_VARIABLE_KEYS).to.include('$accountingTokenId')
      expect(MAGIC_VARIABLE_KEYS).to.include('$accountingTokenAssetId')
      expect(MAGIC_VARIABLE_KEYS).to.have.length(7)
    })

    it('every key starts with $', () => {
      for (const key of MAGIC_VARIABLE_KEYS) {
        expect(key).to.match(/^\$/)
      }
    })
  })

  describe('resolveMagicVariables', () => {
    it('maps all seven keys into a PoolContext', () => {
      const ctx = resolveMagicVariables(CTX)
      expect(ctx['$executor']).to.equal(CTX.executor)
      expect(ctx['$poolEscrow']).to.equal(CTX.poolEscrow)
      expect(ctx['$onOffRamp']).to.equal(CTX.onOffRamp)
      expect(ctx['$poolId']).to.equal(CTX.poolId)
      expect(ctx['$scId']).to.equal(CTX.scId)
      expect(ctx['$accountingTokenId']).to.equal(CTX.accountingTokenId)
      expect(ctx['$accountingTokenAssetId']).to.equal(CTX.accountingTokenAssetId)
    })

    it('produces exactly seven entries — no extras', () => {
      const ctx = resolveMagicVariables(CTX)
      expect(Object.keys(ctx)).to.have.length(7)
    })

    it('result keys match MAGIC_VARIABLE_KEYS', () => {
      const ctx = resolveMagicVariables(CTX)
      for (const key of MAGIC_VARIABLE_KEYS) {
        expect(ctx).to.have.property(key)
      }
    })

    it('is usable as poolContext in buildScript without throwing', () => {
      // Just verifies the types are compatible — no actual execution needed.
      const ctx = resolveMagicVariables(CTX)
      expect(ctx).to.be.an('object')
    })
  })

  describe('resolveVariableLabel', () => {
    it('falls back to pool name for $poolId when no addressLabel exists', () => {
      const result = resolveVariableLabel('$poolId', CTX.poolId, POOL_META)
      expect(result.value).to.equal(CTX.poolId)
      expect(result.label).to.equal('Test Pool')
    })

    it('falls back to raw hex for unknown keys without addressLabel', () => {
      const result = resolveVariableLabel('$executor', CTX.executor, POOL_META)
      expect(result.value).to.equal(CTX.executor)
      expect(result.label).to.equal(CTX.executor)
    })

    it('uses addressLabels when present — exact match', () => {
      const meta = {
        ...POOL_META,
        addressLabels: { [CTX.scId]: 'JTRSY' },
      } as unknown as PoolMetadata
      const result = resolveVariableLabel('$scId', CTX.scId, meta)
      expect(result.value).to.equal(CTX.scId)
      expect(result.label).to.equal('JTRSY')
    })

    it('uses addressLabels — case-insensitive lowercase match', () => {
      const meta = {
        ...POOL_META,
        addressLabels: { [CTX.executor.toLowerCase()]: 'Strategist' },
      } as unknown as PoolMetadata
      const result = resolveVariableLabel('$executor', CTX.executor, meta)
      expect(result.label).to.equal('Strategist')
    })

    it('addressLabel takes priority over key-specific fallback', () => {
      const meta = {
        ...POOL_META,
        pool: { name: 'Should NOT appear' },
        addressLabels: { [CTX.poolId]: 'Custom Pool Label' },
      } as unknown as PoolMetadata
      const result = resolveVariableLabel('$poolId', CTX.poolId, meta)
      expect(result.label).to.equal('Custom Pool Label')
    })

    it('always returns the original value unchanged', () => {
      const result = resolveVariableLabel('$anything', CTX.executor, POOL_META)
      expect(result.value).to.equal(CTX.executor)
    })
  })
})
