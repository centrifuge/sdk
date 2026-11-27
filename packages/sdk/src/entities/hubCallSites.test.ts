import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from 'chai'

// Every hub call an entity sends has to name its pool, or the pre-send policy check skips it. This reads the source of
// the entity files and finds each `contract` of a `wrapTransaction(...)` or `sendCallsInOrder(...)` call, written as
// `contract: expression` or as the shorthand `contract`. Each is a hub site or a named other contract, and a site that
// is neither fails here, so a new call cannot slip past by naming a contract this test has not seen.
//
// What it does not see: files outside `src/entities/` (`Centrifuge.ts`, `src/tx/`), and any send that is not one of
// these two calls (`doTransaction`, `walletClient.sendTransaction`, a helper that wraps them). A hub send written
// there is not checked by this test.

const HUB_EXPRESSIONS = new Set(['hub', 'hubCtx.hub', 'pool.hub', 'v3_3 ? hubCtx.hub : batchRequestManager'])
// A builder's `built.to` is the Hub for these builders and another contract for the others, judged per function.
const HUB_BUILDERS = new Set(['builders.setPoolMetadata', 'builders.shareManagerCall'])
const OTHER_BUILDERS = new Set(['buildMigrationOperation'])
const OTHER_EXPRESSIONS = new Set([
  'self.address',
  // The asset token a balance sheet deposit approves.
  'assetAddress',
  'balanceSheet',
  'balanceSheetAddress(spokeCtx)',
  "'oracleValuation'",
  'oracleValuation',
  'ctx33.gateway',
  'vaultRouter',
  'batchRequestManager',
  'hubCtx.batchRequestManager',
  'spoke',
  'tokenBridge',
  // The StdHubPolicyFactory is not the Hub: deploying a policy names no pool.
  'stdHubPolicyFactory',
  // `Pool.migrationBundle` sends to the migration facade's `multicall`, as `migrationStep` does through `built.to`.
  'bundle.to',
])
// `Hub.initiateAuthorization` is manager-only and no policy classifies it; classifying it would make scheduling
// impossible for a pool with a policy.
const EXEMPT_TITLES = ["'Schedule authorizations'"]
// One transaction that holds `initiateAuthorization` entries and the instant calls of an out-of-policy action: it
// names the pool per call (`policies`), for the instant calls only. `Pool.scheduleOutOfPolicy.test.ts` pins which.
const PER_CALL_TITLES = ["'Schedule out-of-policy action'"]

type Site = {
  file: string
  line: number
  expression: string
  title: string
  hub: boolean | null
  policy: boolean
  policies: boolean
}

const entitiesDir = dirname(fileURLToPath(import.meta.url))

/** The text from `open` (the index of a bracket) to its matching close; strings and comments are not skipped. */
function balanced(source: string, open: number): string {
  const closers: Record<string, string> = { '(': ')', '{': '}', '[': ']' }
  let depth = 0
  for (let index = open; index < source.length; index++) {
    if (source[index]! in closers) depth++
    if (Object.values(closers).includes(source[index]!) && --depth === 0) return source.slice(open, index + 1)
  }
  return source.slice(open)
}

/** The innermost `{ ... }` around `index`. */
function enclosingObject(source: string, index: number): string {
  let depth = 0
  let start = index
  while (start > 0) {
    start--
    if (source[start] === '}') depth++
    if (source[start] === '{') {
      if (depth === 0) break
      depth--
    }
  }
  return balanced(source, start)
}

/** The class member that contains `index`: from the last two-space-indented declaration before it. */
function enclosingMember(source: string, index: number): string {
  const declaration =
    /^ {2}(?:(?:static|private|protected|public|override)\s+)*(?:async\s+)?\*?#?[A-Za-z_$][\w$]*\s*(?:<[^>\n]*>)?\(/gm
  let start = 0
  for (const match of source.slice(0, index).matchAll(declaration)) start = match.index!
  return source.slice(start, index)
}

/** The last capture of `pattern` in `text`. */
function lastCapture(text: string, pattern: RegExp): string | null {
  let found: string | null = null
  for (const match of text.matchAll(pattern)) found = match[1] ?? null
  return found
}

const hubExpression = (expression: string) =>
  HUB_EXPRESSIONS.has(expression) ? true : OTHER_EXPRESSIONS.has(expression) ? false : null
const hubBuilder = (builder: string | null) =>
  builder && HUB_BUILDERS.has(builder) ? true : builder && OTHER_BUILDERS.has(builder) ? false : null

function sitesOf(file: string): Site[] {
  const source = readFileSync(join(entitiesDir, file), 'utf8')
  const sites: Site[] = []
  for (const call of source.matchAll(/\b(?:wrapTransaction|sendCallsInOrder)\(/g)) {
    const open = call.index! + call[0].length - 1
    const text = balanced(source, open)
    const callTitle = /^\(\s*([^,]+),\s*ctx/.exec(text)?.[1]?.trim()
    for (const key of text.matchAll(/(?<![\w.])contract(?:\s*:\s*([^,\n}]+)|(?=\s*[,}\n]))/g)) {
      const index = open + key.index!
      const object = enclosingObject(source, index)
      const expression = (key[1] ?? 'contract').trim()
      const builder = lastCapture(enclosingMember(source, index), /const built = ([\w.]+)\(/g)
      sites.push({
        file,
        line: source.slice(0, index).split('\n').length,
        expression,
        title: /\btitle:\s*([^,\n]+)/.exec(object)?.[1]?.trim() ?? callTitle ?? '',
        hub: expression === 'built.to' ? hubBuilder(builder) : hubExpression(expression),
        policy: /\bpolicy:\s*\{\s*poolId\b/.test(object),
        policies: /\bpolicies:/.test(object),
      })
    }
  }
  return sites
}

const sources = readdirSync(entitiesDir).filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
const sites = sources.flatMap(sitesOf)
const where = (site: Site) => `${site.file}:${site.line} (${site.title}) contract: ${site.expression}`

describe('hub call sites in the entities', () => {
  it('classifies every contract a transaction is sent to as the Hub or another contract', () => {
    expect(sites.filter((site) => site.hub === null).map(where)).to.deep.equal([])
  })

  it('finds the hub sites it is meant to check', () => {
    expect(sites.filter((site) => site.hub === true).length).to.be.greaterThan(40)
  })

  it('names the pool at every hub call site but the ones that schedule', () => {
    const hubSites = sites.filter((site) => site.hub === true)
    const withoutPolicy = hubSites.filter((site) => !site.policy && !site.policies)

    expect(withoutPolicy.map((site) => site.title)).to.deep.equal(EXEMPT_TITLES)
    expect(hubSites.filter((site) => site.policy)).to.have.length(
      hubSites.length - EXEMPT_TITLES.length - PER_CALL_TITLES.length
    )
  })

  it('names the pool per call at the one site that mixes calls to schedule with calls to send, and nowhere else', () => {
    const perCall = sites.filter((site) => site.policies)

    expect(perCall.map((site) => site.title)).to.deep.equal(PER_CALL_TITLES)
    expect(perCall.every((site) => site.hub === true && !site.policy)).to.equal(true)
  })

  it('names no pool at a call to a contract that is not the Hub', () => {
    expect(sites.filter((site) => site.hub === false && site.policy).map(where)).to.deep.equal([])
  })

  describe('reading the sources', () => {
    const sitesIn = (code: string) => {
      const found: Site[] = []
      for (const call of code.matchAll(/\b(?:wrapTransaction|sendCallsInOrder)\(/g)) {
        const open = call.index! + call[0].length - 1
        const text = balanced(code, open)
        for (const key of text.matchAll(/(?<![\w.])contract(?:\s*:\s*([^,\n}]+)|(?=\s*[,}\n]))/g)) {
          found.push({ expression: (key[1] ?? 'contract').trim() } as Site)
        }
      }
      return found.map((site) => site.expression)
    }

    it('finds a contract written as shorthand', () => {
      expect(sitesIn("yield* wrapTransaction('Update', ctx, { contract, data })")).to.deep.equal(['contract'])
      expect(sitesIn("yield* wrapTransaction('Update', ctx, {\n  contract,\n  data,\n})")).to.deep.equal(['contract'])
    })

    it('finds a contract in every entry of a sendCallsInOrder list', () => {
      expect(
        sitesIn(
          "yield* sendCallsInOrder('Deploy', ctx, [{ title: 'a', contract: hub }, { title: 'b', contract: spoke }])"
        )
      ).to.deep.equal(['hub', 'spoke'])
    })

    it('ignores a contract outside these two calls', () => {
      expect(sitesIn('const read = getContract({ contract: hub })')).to.deep.equal([])
    })

    it('judges built.to by the builder of its own function, and by none from another function', () => {
      const code = [
        'class A {',
        '  first() {',
        '    const built = builders.setPoolMetadata(context, {})',
        '    return built.to',
        '  }',
        '  second(built: Built) {',
        "    yield* wrapTransaction('Step', ctx, { contract: built.to, data: built.data })",
        '  }',
        '}',
      ].join('\n')
      const index = code.indexOf('contract: built.to')

      expect(lastCapture(enclosingMember(code, index), /const built = ([\w.]+)\(/g)).to.equal(null)
    })
  })
})
