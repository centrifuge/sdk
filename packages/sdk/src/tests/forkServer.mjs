import childProcess from 'child_process'
import http from 'http'

let fork = null
function killFork() {
  const deferred = Promise.withResolvers()
  if (fork) {
    fork.on('exit', () => {
      console.log('Fork process killed successfully')
      fork = null
      deferred.resolve()
    })
    fork.kill()
    setTimeout(() => {
      // If the fork doesn't exit after 2 seconds, we assume it failed to kill
      deferred.reject(new Error('Fork process did not exit after kill signal'))
    }, 2000)
  } else {
    console.log('No fork to kill')
    deferred.resolve()
  }
  return deferred.promise
}

function spawnFork() {
  let resolved = false
  const deferred = Promise.withResolvers()
  if (fork) {
    console.log('Fork already in running')
    return
  }
  console.log('Spawning fork...')
  fork = childProcess.spawn('anvil', [
    '--fork-url',
    'https://eth-sepolia.api.onfinality.io/rpc?apikey=18704429-288d-4f55-bda8-8b60f4c53b96',
    '--auto-impersonate',
  ])
  fork.on('exit', (code) => {
    if (!resolved) deferred.reject(new Error(`Fork process exited before starting with code ${code}`))
    console.log(`Fork process exited with code ${code}`)
    fork = null
  })
  fork.on('error', (err) => {
    console.error('Error spawning fork:', err)
    fork = null
    deferred.reject(err)
  })

  fork.stdout.setEncoding('utf8')
  fork.stdout.on('data', (data) => {
    if (!resolved) {
      console.log('Fork started successfully')
      resolved = true
      deferred.resolve()
    }
    console.log(data)
  })

  fork.stderr.setEncoding('utf8')
  fork.stderr.on('data', (data) => {
    console.error(data)
  })

  return deferred.promise
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST') {
      console.log('Forking Sepolia')
      if (fork) {
        await killFork()
        console.log('Killed existing fork')
      }
      await spawnFork()
      console.log('Forked Sepolia successfully')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ rpcUrl: 'http://127.0.0.1:8545/' }))
    } else if (req.method === 'DELETE') {
      console.log('Killing fork')
      if (fork) {
        killFork()
        res.writeHead(204, { 'Content-Type': 'text/plain' })
        res.end()
      } else {
        res.writeHead(400, { 'Content-Type': 'text/plain' })
        res.end('No fork active')
      }
    } else {
      res.writeHead(405, { 'Content-Type': 'text/plain' })
      res.end()
    }
  } catch (e) {
    console.error(e)
    res.writeHead(500, { 'Content-Type': 'text/plain' })
  }
})

server.listen(8544, () => {
  console.log(`Server is running on http://localhost:8544
POST http://localhost:8544/ to fork Sepolia
DELETE http://localhost:8544/ to tear down the fork
`)
})
