# Contributing to Centrifuge SDK

Thank you for your interest in contributing to the Centrifuge SDK! This guide will help you get started with contributing code, documentation, and improvements to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Environment](#development-environment)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Testing Guidelines](#testing-guidelines)
- [Code Style](#code-style)
- [Documentation](#documentation)
- [Pull Request Process](#pull-request-process)
- [Release Process](#release-process)
- [Community](#community)

## Code of Conduct

This project adheres to the [Centrifuge Code of Conduct](https://github.com/centrifuge/code-of-conduct). By participating, you are expected to uphold this code. Please report unacceptable behavior to [conduct@centrifuge.io](mailto:conduct@centrifuge.io).

## Getting Started

### Prerequisites

- **Node.js** ≥ 18.0.0
- **pnpm** ≥ 8.0.0
- **Git** ≥ 2.0.0

### Quick Setup

```bash
# Clone the repository
git clone https://github.com/centrifuge/sdk.git
cd sdk

# Install dependencies
pnpm install

# Run tests to verify setup
pnpm test

# Start development
pnpm dev
```

## Development Environment

### Repository Structure

```
sdk/
├── src/                    # Source code
│   ├── entities/          # Core business logic entities
│   ├── utils/             # Utility functions
│   ├── types/             # Type definitions
│   ├── abi/               # Contract ABIs
│   ├── config/            # Configuration files
│   └── index.ts           # Main entry point
├── tests/                 # Test files
│   ├── unit/              # Unit tests
│   ├── integration/       # Integration tests
│   └── fixtures/          # Test data
├── docs/                  # Documentation
├── examples/              # Usage examples
└── scripts/               # Build and utility scripts
```

### Environment Variables

Create a `.env` file in the root directory:

```bash
# RPC URLs for testing (optional)
ETHEREUM_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/your-key
BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/your-key
ARBITRUM_RPC_URL=https://arb-mainnet.g.alchemy.com/v2/your-key

# Test wallet private key (for integration tests)
TEST_PRIVATE_KEY=0x...

# GraphQL endpoint (usually not needed to override)
INDEXER_URL=https://api.centrifuge.io
```

### IDE Setup

#### VS Code

Recommended extensions:
- **TypeScript and JavaScript Language Features**
- **ESLint**
- **Prettier**
- **GitLens**
- **Thunder Client** (for GraphQL testing)

Workspace settings (`.vscode/settings.json`):
```json
{
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "typescript.preferences.importModuleSpecifier": "relative"
}
```

## Project Structure

### Core Modules

```typescript
// Main SDK class
src/Centrifuge.ts

// Core entities
src/entities/
├── Pool.ts              # Investment pools
├── Vault.ts             # ERC-7540 tokenized vaults
├── Investor.ts          # Cross-chain investors
├── ShareClass.ts        # Share class management
└── BalanceSheet.ts      # Financial reporting

// Utilities
src/utils/
├── transaction.ts       # Transaction handling
├── cache.ts            # Caching system
├── observable.ts       # Observable utilities
├── validation.ts       # Input validation
└── types.ts            # Type utilities

// Type definitions
src/types/
├── index.ts            # Public types
├── graphql.ts          # Generated GraphQL types
└── internal.ts         # Internal types
```

### Adding New Features

When adding new features, follow this structure:

1. **Entity**: If it's a new business concept, create an entity class
2. **Utility**: If it's a helper function, add to appropriate utility module
3. **Type**: Add type definitions to the types module
4. **Test**: Create comprehensive tests
5. **Documentation**: Update API documentation and examples

## Development Workflow

### Branch Management

We use **Git Flow** with the following branches:

- `main`: Production-ready code
- `develop`: Integration branch for features
- `feature/*`: New features
- `hotfix/*`: Critical bug fixes
- `release/*`: Release preparation

### Feature Development

```bash
# Create feature branch from develop
git checkout develop
git pull origin develop
git checkout -b feature/your-feature-name

# Make your changes
# ... code, test, commit ...

# Push and create PR
git push origin feature/your-feature-name
```

### Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description

feat(pool): add support for multi-currency pools
fix(vault): handle edge case in redemption calculation
docs(readme): update installation instructions
test(investor): add portfolio aggregation tests
refactor(transaction): simplify observable error handling
chore(deps): update viem to latest version
```

**Types:**
- `feat`: New features
- `fix`: Bug fixes
- `docs`: Documentation changes
- `test`: Adding/updating tests
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `chore`: Maintenance tasks

## Testing Guidelines

### Test Structure

```
tests/
├── unit/                   # Fast, isolated tests
│   ├── entities/          # Test entity classes
│   ├── utils/             # Test utilities
│   └── types/             # Test type guards
├── integration/           # Tests with external dependencies
│   ├── blockchain/        # Blockchain interaction tests
│   ├── graphql/           # GraphQL query tests
│   └── e2e/               # End-to-end scenarios
└── fixtures/              # Test data and mocks
```

### Writing Tests

#### Unit Tests

```typescript
// tests/unit/entities/Pool.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { Pool } from '../../../src/entities/Pool'
import { mockCentrifuge } from '../../fixtures/mocks'

describe('Pool', () => {
  let pool: Pool
  
  beforeEach(() => {
    pool = new Pool('test-pool', mockCentrifuge)
  })
  
  it('should fetch pool details', async () => {
    const details = await pool.details()
    
    expect(details).toBeDefined()
    expect(details.id).toBe('test-pool')
    expect(details.totalValueLocked.toBigInt()).toBeGreaterThan(0n)
  })
  
  it('should handle missing pool gracefully', async () => {
    const nonExistentPool = new Pool('non-existent', mockCentrifuge)
    
    await expect(nonExistentPool.details()).rejects.toThrow('Pool not found')
  })
})
```

#### Integration Tests

```typescript
// tests/integration/blockchain/vault.test.ts
import { describe, it, expect } from 'vitest'
import Centrifuge from '../../../src'

describe('Vault Integration', () => {
  it('should interact with real vault contract', async () => {
    const centrifuge = new Centrifuge({ environment: 'testnet' })
    
    // Use actual testnet data
    const pool = await centrifuge.pool('test-pool-id')
    const vault = await pool.vault(11155111, 'test-share-class', '0x...')
    
    const details = await vault.details()
    expect(details.address).toMatch(/^0x[a-fA-F0-9]{40}$/)
  })
})
```

### Running Tests

```bash
# Run all tests
pnpm test

# Run unit tests only
pnpm test:unit

# Run integration tests
pnpm test:integration

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:coverage
```

### Test Guidelines

1. **Arrange, Act, Assert**: Structure tests clearly
2. **Descriptive Names**: Test names should explain the scenario
3. **Single Responsibility**: One assertion per test when possible
4. **Mock External Dependencies**: Use mocks for blockchain/API calls
5. **Test Edge Cases**: Include error scenarios and boundary conditions

## Code Style

### TypeScript Guidelines

1. **Strict Mode**: Use strict TypeScript configuration
2. **Explicit Types**: Prefer explicit types over `any`
3. **Interfaces vs Types**: Use interfaces for object shapes, types for unions
4. **Naming Conventions**:
   - `PascalCase` for classes, interfaces, types
   - `camelCase` for functions, variables
   - `UPPER_SNAKE_CASE` for constants
   - `kebab-case` for files

### ESLint Configuration

The project uses ESLint with these key rules:

```json
{
  "extends": [
    "@typescript-eslint/recommended",
    "prettier"
  ],
  "rules": {
    "@typescript-eslint/explicit-function-return-type": "error",
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-unused-vars": "error",
    "prefer-const": "error",
    "no-var": "error"
  }
}
```

### Prettier Configuration

```json
{
  "semi": false,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100
}
```

### Code Organization

```typescript
// Good: Organized imports
import { Observable } from 'rxjs'
import { PublicClient } from 'viem'

import { Balance, Price } from '../types'
import { validateAddress } from '../utils/validation'
import { CentrifugeError } from '../utils/errors'

// Good: Clear class structure
export class Vault {
  // 1. Properties
  public readonly address: HexString
  private readonly client: PublicClient
  
  // 2. Constructor
  constructor(address: HexString, client: PublicClient) {
    this.address = validateAddress(address)
    this.client = client
  }
  
  // 3. Public methods
  public async details(): Promise<VaultDetails> {
    // Implementation
  }
  
  // 4. Private methods
  private async fetchContractData(): Promise<RawVaultData> {
    // Implementation
  }
}
```

## Documentation

### API Documentation

All public APIs must include JSDoc comments:

```typescript
/**
 * Represents an investment vault implementing ERC-7540 standard.
 * 
 * Vaults allow investors to deposit assets and receive shares representing
 * their proportional ownership in the underlying pool assets.
 * 
 * @example
 * ```typescript
 * const vault = await pool.vault(1, 'shareClassId', '0x...')
 * const investment = await vault.investment('0x...')
 * await vault.increaseInvestOrder(Balance.fromFloat(1000, 6))
 * ```
 */
export class Vault {
  /**
   * Increases the investment order for the specified amount.
   * 
   * This creates a pending investment order that will be processed
   * during the next epoch close.
   * 
   * @param amount - The amount to invest
   * @returns Observable transaction that resolves when confirmed
   * @throws {InsufficientBalanceError} When investor has insufficient balance
   * @throws {UnauthorizedError} When investor is not authorized
   */
  increaseInvestOrder(amount: Balance): Transaction {
    // Implementation
  }
}
```

### README Updates

When adding features, update the main README:

1. Add to feature list if significant
2. Update quick start if it affects basic usage
3. Add to examples section if appropriate

### Example Updates

Add examples to the `examples/` directory:

```typescript
// examples/basic-investment.ts
import Centrifuge, { Balance } from '@centrifuge/sdk'

async function example() {
  const centrifuge = new Centrifuge({ environment: 'testnet' })
  
  // Your example code here
}
```

## Pull Request Process

### Before Submitting

1. **Tests Pass**: All tests must pass
2. **Lint Clean**: No linting errors
3. **Type Check**: No TypeScript errors
4. **Documentation**: Update docs if needed
5. **Examples**: Add examples for new features

### PR Checklist

- [ ] Branch is up to date with target branch
- [ ] All tests pass locally
- [ ] Code follows style guidelines
- [ ] Documentation is updated
- [ ] Commit messages follow convention
- [ ] Breaking changes are documented
- [ ] Examples demonstrate new features

### PR Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update

## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Manual testing completed

## Documentation
- [ ] API documentation updated
- [ ] README updated if needed
- [ ] Examples added/updated

## Breaking Changes
List any breaking changes and migration guide

## Additional Notes
Any additional context or notes for reviewers
```

### Review Process

1. **Automated Checks**: CI/CD must pass
2. **Code Review**: At least 2 approvals required
3. **Documentation Review**: Ensure docs are accurate
4. **Testing Review**: Verify test coverage
5. **Security Review**: Check for security implications

## Release Process

### Version Numbers

We follow [Semantic Versioning](https://semver.org/):

- **MAJOR** (1.0.0): Breaking changes
- **MINOR** (0.1.0): New features (backward compatible)  
- **PATCH** (0.0.1): Bug fixes (backward compatible)

### Release Checklist

1. **Update Version**: Update `package.json` version
2. **Update Changelog**: Document all changes
3. **Update Documentation**: Ensure docs are current
4. **Run Full Test Suite**: All tests must pass
5. **Create Release Branch**: `release/v1.2.3`
6. **Create Release PR**: Merge to main
7. **Tag Release**: Create Git tag
8. **Publish Package**: Release to npm
9. **Update Documentation**: Deploy updated docs

### Changelog Format

```markdown
## [1.2.3] - 2024-01-15

### Added
- New feature descriptions

### Changed  
- Behavior changes

### Deprecated
- Features being phased out

### Removed
- Removed features

### Fixed
- Bug fixes

### Security
- Security improvements
```

## Community

### Communication Channels

- **GitHub Issues**: Bug reports and feature requests
- **GitHub Discussions**: General questions and community discussion
- **Discord**: [Centrifuge Discord](https://discord.gg/centrifuge)
- **Forum**: [Centrifuge Forum](https://gov.centrifuge.io)

### Getting Help

1. **Documentation**: Check docs first
2. **Search Issues**: Look for existing solutions
3. **Ask Questions**: Use GitHub Discussions
4. **Join Discord**: Real-time community help

### Reporting Issues

Use the issue templates:

**Bug Report:**
- Describe the bug
- Steps to reproduce  
- Expected vs actual behavior
- Environment details
- Code samples

**Feature Request:**
- Clear description of the feature
- Use cases and motivation
- Proposed implementation (optional)
- Alternatives considered

### Becoming a Maintainer

Regular contributors may be invited to become maintainers. Maintainers have:

- Write access to the repository
- Ability to review and merge PRs
- Responsibility for project direction
- Commitment to code quality and community

To become a maintainer:

1. **Contribute Regularly**: Consistent, quality contributions
2. **Help Others**: Answer questions and review PRs
3. **Follow Guidelines**: Demonstrate understanding of project standards
4. **Express Interest**: Let current maintainers know you're interested

Thank you for contributing to the Centrifuge SDK! Your contributions help make DeFi more accessible and powerful for everyone.