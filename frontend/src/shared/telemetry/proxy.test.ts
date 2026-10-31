import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import handler from '../../../pages/api/telemetry.ts';

type Request = Parameters<typeof handler>[0];
type Response = Parameters<typeof handler>[1];

const response = () => {
  const result = { code: 200, headers: new Map<string, string>(), ended: false };
  const res = {
    setHeader(key: string, value: string) { result.headers.set(key, value); },
    status(code: number) { result.code = code; return res; },
    end() { result.ended = true; },
  };
  return { result, res: res as unknown as Response };
};

test('proxy authenticates server-side, rejects cross-origin requests, and fails without affecting pages', async () => {
  const previousBase = process.env.TELEMETRY_API_BASE_URL;
  const previousToken = process.env.TELEMETRY_TOKEN;
  let receivedToken = '';
  let receivedBody = '';
  let receivedPath = '';
  const upstream = createServer((req, res) => {
    receivedToken = req.headers.authorization ?? '';
    receivedPath = req.url ?? '';
    req.on('data', (chunk) => { receivedBody += chunk; });
    req.on('end', () => { res.writeHead(204); res.end(); });
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  try {
    const address = upstream.address();
    assert.ok(address && typeof address === 'object');
    process.env.TELEMETRY_API_BASE_URL = `http://127.0.0.1:${address.port}`;
    process.env.TELEMETRY_TOKEN = 'server-only-token';
    const body = { id: 'proxy-event-0000001', kind: 'page_view', mode: 'setup' };
    const req = { method: 'POST', headers: { host: 'app.example', origin: 'https://app.example' }, body } as Request;
    const success = response();
    await handler(req, success.res);
    assert.equal(success.result.code, 204);
    assert.equal(receivedToken, 'Bearer server-only-token');
    assert.equal(receivedPath, '/v1/telemetry');
    assert.deepEqual(JSON.parse(receivedBody), body);
    assert.ok(!JSON.stringify(success.result).includes('server-only-token'));

    for (const origin of ['https://foreign.example', 'invalid-url']) {
      const rejected = response();
      await handler({ ...req, headers: { host: 'app.example', origin } } as Request, rejected.res);
      assert.equal(rejected.result.code, 403);
    }
    const get = response();
    await handler({ ...req, method: 'GET' } as Request, get.res);
    assert.equal(get.result.code, 405);

    delete process.env.TELEMETRY_TOKEN;
    const disabled = response();
    await handler(req, disabled.res);
    assert.equal(disabled.result.code, 503);
    process.env.TELEMETRY_TOKEN = 'server-only-token';
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    const outage = response();
    await handler(req, outage.res);
    assert.equal(outage.result.code, 503);
  } finally {
    upstream.close();
    if (previousBase === undefined) delete process.env.TELEMETRY_API_BASE_URL;
    else process.env.TELEMETRY_API_BASE_URL = previousBase;
    if (previousToken === undefined) delete process.env.TELEMETRY_TOKEN;
    else process.env.TELEMETRY_TOKEN = previousToken;
  }
});
