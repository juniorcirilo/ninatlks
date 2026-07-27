import { createServer } from 'node:http'
import { createReadStream, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const CLIENT_DIR = join(__dirname, 'dist/client')
const PORT = Number(process.env.PORT) || 8080

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

const { default: ssrHandler } = await import('./dist/server/index.js')

function tryStatic(pathname) {
  const filePath = join(CLIENT_DIR, pathname)
  try {
    const stat = statSync(filePath)
    if (stat.isFile()) return filePath
  } catch {}
  return null
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')

  const staticFile = tryStatic(url.pathname)
  if (staticFile) {
    const contentType = MIME[extname(staticFile)] || 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': contentType })
    await pipeline(createReadStream(staticFile), res)
    return
  }

  try {
    const hasBody = !['GET', 'HEAD'].includes(req.method ?? 'GET')
    const webReq = new Request(`http://localhost${req.url}`, {
      method: req.method,
      headers: req.headers,
      ...(hasBody ? { body: req, duplex: 'half' } : {}),
    })

    const webRes = await ssrHandler.fetch(webReq)
    const headers = {}
    webRes.headers.forEach((v, k) => { headers[k] = v })
    res.writeHead(webRes.status, headers)

    if (webRes.body) {
      const reader = webRes.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(value)
      }
      reader.releaseLock()
    }
    res.end()
  } catch (e) {
    console.error(e)
    res.writeHead(500)
    res.end('Internal Server Error')
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`)
})
