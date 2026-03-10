// Basecoin RPC Proxy — proxy.js
// Run: node proxy.js
// Listens on port 3001, proxies to Basecoin RPC on 127.0.0.1:6554

const http = require('http');

const RPC_HOST = '127.0.0.1';
const RPC_PORT = 6554;
const RPC_USER = 'basecoin';
const RPC_PASS = 'basecoin2026';
const PROXY_PORT = 3001;

// ── RPC call helper ──────────────────────────────────────────────────────────
function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: '1', method, params: params || [] });
    const auth  = Buffer.from(`${RPC_USER}:${RPC_PASS}`).toString('base64');
    const opts  = {
      hostname: RPC_HOST, port: RPC_PORT, path: '/', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${auth}`, 'Content-Length': Buffer.byteLength(body) }
    };
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.error) reject(j.error);
          else resolve(j.result);
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Route handlers ───────────────────────────────────────────────────────────
async function getStats() {
  const [info, mining, net] = await Promise.all([
    rpc('getblockchaininfo'),
    rpc('getmininginfo'),
    rpc('getnetworkinfo')
  ]);
  return {
    blocks:     info.blocks,
    bestHash:   info.bestblockhash,
    difficulty: info.difficulty,
    chainwork:  info.chainwork,
    hashrate:   mining.networkhashps,
    generating: mining.generate,
    peers:      net.connections,
    version:    net.subversion,
    warnings:   info.warnings || ''
  };
}

async function getRecentBlocks(count) {
  count = Math.min(parseInt(count) || 10, 20);
  const info   = await rpc('getblockchaininfo');
  const height = info.blocks;
  const blocks = [];
  for (let i = height; i > Math.max(0, height - count); i--) {
    const hash  = await rpc('getblockhash', [i]);
    const block = await rpc('getblock', [hash, 1]);
    blocks.push({
      height: block.height,
      hash:   block.hash,
      time:   block.time,
      txcount:block.tx.length,
      size:   block.size,
      nonce:  block.nonce,
      bits:   block.bits,
      difficulty: block.difficulty
    });
  }
  return blocks;
}

async function getBlock(hashOrHeight) {
  let hash = hashOrHeight;
  if (/^\d+$/.test(hashOrHeight)) {
    hash = await rpc('getblockhash', [parseInt(hashOrHeight)]);
  }
  const block = await rpc('getblock', [hash, 2]);
  return block;
}

async function getTx(txid) {
  return await rpc('getrawtransaction', [txid, true]);
}

async function getAddress(addr) {
  // Use scantxoutset for UTXO balance
  const scan = await rpc('scantxoutset', ['start', [`addr(${addr})`]]);
  return {
    address:  addr,
    balance:  scan.total_amount || 0,
    utxos:    scan.unspents || []
  };
}

async function getRecentTxs(count) {
  count = Math.min(parseInt(count) || 10, 20);
  const info   = await rpc('getblockchaininfo');
  const height = info.blocks;
  const txs    = [];
  for (let i = height; i > Math.max(0, height - 5) && txs.length < count; i--) {
    const hash  = await rpc('getblockhash', [i]);
    const block = await rpc('getblock', [hash, 2]);
    for (const tx of block.tx.slice(0, 5)) {
      txs.push({
        txid:   tx.txid,
        block:  i,
        time:   block.time,
        vin:    tx.vin.length,
        vout:   tx.vout.length,
        size:   tx.size
      });
      if (txs.length >= count) break;
    }
  }
  return txs;
}

// ── HTTP Server ──────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  // CORS headers — allow any origin (explorer on same server)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url   = new URL(req.url, `http://${req.headers.host}`);
  const path  = url.pathname;

  try {
    let result;

    if (path === '/api/stats') {
      result = await getStats();

    } else if (path === '/api/blocks') {
      const count = url.searchParams.get('count') || 10;
      result = await getRecentBlocks(count);

    } else if (path.startsWith('/api/block/')) {
      const id = path.split('/api/block/')[1];
      result = await getBlock(id);

    } else if (path.startsWith('/api/tx/')) {
      const txid = path.split('/api/tx/')[1];
      result = await getTx(txid);

    } else if (path.startsWith('/api/address/')) {
      const addr = path.split('/api/address/')[1];
      result = await getAddress(addr);

    } else if (path === '/api/txs') {
      const count = url.searchParams.get('count') || 10;
      result = await getRecentTxs(count);

    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    res.writeHead(200);
    res.end(JSON.stringify(result));

  } catch (err) {
    console.error('[ERROR]', path, err);
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message || String(err) }));
  }
});

server.listen(PROXY_PORT, '0.0.0.0', () => {
  console.log(`Basecoin RPC Proxy running on port ${PROXY_PORT}`);
  console.log(`Proxying to ${RPC_HOST}:${RPC_PORT}`);
});
