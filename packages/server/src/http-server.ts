import { createServer, type Server } from 'node:http';

const jsonHeaders = { 'content-type': 'application/json' };

export function createHttpServer(): Server {
  return createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200, jsonHeaders).end(JSON.stringify({ status: 'ok' }));
      return;
    }
    response.writeHead(404, jsonHeaders).end(JSON.stringify({ error: 'not_found' }));
  });
}
