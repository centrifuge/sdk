const fs = require('fs/promises')
const path = require('path')
const simpleGit = require('simple-git')

async function copyDocs(sourceDir, targetDir) {
  try {
    // Create the target directory if it doesn't exist
    await fs.mkdir(targetDir, { recursive: true })

    // Get all files from docs directory recursively
    const getFiles = async (dir) => {
      const items = await fs.readdir(dir, { withFileTypes: true })
      const files = await Promise.all(
        items.map(async (item) => {
          const filePath = path.join(dir, item.name)
          return item.isDirectory() ? getFiles(filePath) : filePath
        })
      )
      return files.flat()
    }

    const docFiles = await getFiles(sourceDir)

    // Copy each file to the target directory, maintaining directory structure
    for (const file of docFiles) {
      const relativePath = path.relative(sourceDir, file)
      const targetPath = path.join(targetDir, relativePath)

      // Create the nested directory structure if it doesn't exist
      await fs.mkdir(path.dirname(targetPath), { recursive: true })

      // Copy the file, overwriting if it exists
      await fs.copyFile(file, targetPath)
      console.log(`Copied: ${relativePath}`)
    }
  } catch (error) {
    console.error('Error copying docs:', error)
    throw error
  }
}

async function main() {
  try {
    // Clone the SDK docs repo
    const git = simpleGit()
    const repoUrl = `https://x-access-token:${process.env.GITHUB_TOKEN}@github.com/centrifuge/sdk-docs.git`
    await git.clone(repoUrl, './sdk-docs')

    // TODO: remove: Change into the sdk-docs directory and checkout the branch
    // await git.cwd('./sdk-docs').checkout('generate-docs')

    // Copy docs to the target location
    await copyDocs(
      './docs', // source directory
      './sdk-docs/source/includes' // target directory
    )

    // Create and switch to a new branch
    const branchName = `docs-update-${new Date().toISOString().split('T')[0]}`
    await git
      .cwd('./sdk-docs') // Ensure we're in the sdk-docs directory
      .checkoutLocalBranch(branchName)

    // Add and commit changes
    await git.add('.').commit('Update SDK documentation')

    // Push the new branch
    await git.push('origin', branchName)

    // Create PR using GitHub CLI
    const prTitle = 'Update SDK Documentation'
    const prBody = 'Automated PR to update SDK documentation'
    const prCommand = `gh pr create \
      --title "${prTitle}" \
      --body "${prBody}" \
      --base main \
      --head ${branchName} \
      --repo "org/sdk-docs"`

    const { execSync } = require('child_process')
    execSync(prCommand, {
      stdio: 'inherit',
      env: { ...process.env },
    })

    console.log('Successfully created PR with documentation updates')
  } catch (error) {
    console.error('Failed to process docs:', error)
    process.exit(1)
  }
}

main()
