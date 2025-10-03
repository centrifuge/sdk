import { exec } from 'child_process'

const indexerUrl = 'http://localhost:8000/ready'
const timeout = 30000
const interval = 2000

function runCommand(cmd) {
  return new Promise((resolve, reject) => {
    const process = exec(cmd, (err, stdout, stderr) => {
      if (err) return reject(err)
      resolve({ stdout, stderr })
    })
    process.stdout.pipe(process.stdout)
    process.stderr.pipe(process.stderr)
  })
}

async function waitFor(url) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch (e) {
      console.log(`Waiting for ${url}`)
    }
    await new Promise((r) => setTimeout(r, interval))
  }
  throw new Error(`Service at ${url} did not become ready in ${timeout / 1000}s`)
}

async function main() {
  console.log('Starting containers...')
  await runCommand('docker compose up -d')

  console.log('Waiting for indexer...')
  await waitFor(indexerUrl)

  console.log('All done. You can run tests with "yarn run test"')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
