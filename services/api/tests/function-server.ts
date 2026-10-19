import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'

// A real Node request/response harness; production Functions never call listen().
export async function serveFunction(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
) {
  const server = createServer((req, res) => {
    void handler(req, res).catch(() => {
      res.destroy()
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('TCP address required')
  }
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  }
}
