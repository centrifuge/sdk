const fs = require('fs/promises')
const path = require('path')
const simpleGit = require('simple-git')
const { execSync } = require('child_process')

/**
 * Recursively gets all files from a directory
 */
async function getFilesRecursively(dir) {
  const items = await fs.readdir(dir, { withFileTypes: true })
  const files = await Promise.all(
    items.map(async (item) => {
      const filePath = path.join(dir, item.name)
      return item.isDirectory() ? getFilesRecursively(filePath) : filePath
    })
  )
  return files.flat()
}

/**
 * Cleans generated documentation folders: classes and type-aliases
 */
async function cleanGeneratedDocs(targetDir) {
  const foldersToClean = ['classes', 'type-aliases']
  for (const folder of foldersToClean) {
    const folderPath = path.join(targetDir, folder)
    try {
      await fs.rm(folderPath, { recursive: true, force: true })
      console.log(`✨ Cleared existing ${folder} folder`)
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error(`❌ Error clearing ${folder} folder:`, error)
      }
    }
  }
}

/**
 * Copies documentation files while maintaining structure
 */
async function copyDocs(sourceDir, targetDir) {
  try {
    await fs.mkdir(targetDir, { recursive: true })
    await cleanGeneratedDocs(targetDir)

    const docFiles = await getFilesRecursively(sourceDir)
    for (const file of docFiles) {
      const relativePath = path.relative(sourceDir, file)
      if (path.basename(file) === 'README.md') continue

      const targetPath = path.join(targetDir, relativePath)
      await fs.mkdir(path.dirname(targetPath), { recursive: true })
      await fs.copyFile(file, targetPath)
      console.log(`📄 Copied: ${relativePath}`)
    }
  } catch (error) {
    console.error('❌ Error copying docs:', error)
    throw error
  }
}

/**
 * Creates _category_.yml files in each directory with proper formatting
 */
async function createCategoryFiles(targetDir) {
  try {
    const directories = await fs.readdir(targetDir, { withFileTypes: true })

    for (const dirent of directories) {
      if (dirent.isDirectory()) {
        const dirPath = path.join(targetDir, dirent.name)

        // Format the directory name
        const label = dirent.name
          .split('-')
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ')

        const categoryContent = `label: ${label}\n`
        await fs.writeFile(path.join(dirPath, '_category_.yml'), categoryContent)

        // Recursively process subdirectories
        await createCategoryFiles(dirPath)
      }
    }
  } catch (error) {
    console.error('❌ Error creating category files:', error)
    throw error
  }
}

/**
 * Creates a PR in the sdk-docs repository
 */
async function createPullRequest(git, branchName) {
  const prTitle = '[sdk:ci:bot] Update SDK Documentation'
  const prBody =
    '[sdk:ci:bot] Automated PR to update SDK documentation: [Actions](https://github.com/centrifuge/sdk/actions/workflows/update-docs.yml)'

  const prCommand = `gh pr create \
    --title "${prTitle}" \
    --body "${prBody}" \
    --base main \
    --head ${branchName} \
    --repo "centrifuge/sdk-docs"`

  execSync(prCommand, {
    stdio: 'inherit',
    env: { ...process.env, GH_TOKEN: process.env.PAT_TOKEN },
  })
}

async function hasChanges(git) {
  try {
    await git.fetch('origin', 'main')

    // Get the diff between current state and main branch
    const diff = await git.diff(['origin/main'])

    return diff.length > 0
  } catch (error) {
    console.error('❌ Error checking for changes:', error)
    throw error
  }
}

async function main() {
  try {
    const git = simpleGit()
    const repoUrl = `https://${process.env.PAT_TOKEN}@github.com/centrifuge/documentation.git`

    await git.clone(repoUrl)

    await git
      .cwd('./documentation')
      .addConfig('user.name', 'github-actions[bot]')
      .addConfig('user.email', 'github-actions[bot]@users.noreply.github.com')

    await copyDocs('./docs', './documentation/docs/developer/centrifuge-sdk/reference')
    await createCategoryFiles('./documentation/docs/developer/centrifuge-sdk/reference')

    if (await hasChanges(git)) {
      const branchName = `sdk-update-${new Date().toISOString().slice(0, 19).replace(/[:-]/g, '').replace(' ', '-')}`
      await git.checkoutLocalBranch(branchName)
      await git.add('.').commit('Update SDK documentation')
      await git.push('origin', branchName)

      await createPullRequest(git, branchName)
      console.log('✅ Successfully created PR with documentation updates')
    } else {
      console.log('ℹ️  No documentation changes detected')
    }
    process.exit(0)
  } catch (error) {
    console.error('❌ Failed to process docs:', error)
    process.exit(1)
  }
}

main()
