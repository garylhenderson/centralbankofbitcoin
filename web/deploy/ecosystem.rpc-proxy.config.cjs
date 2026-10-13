// PM2 definition for the RPC proxy. The reviewed go-live workflow installs it.
// The env file is root:ubuntu 0640 (legacy ubuntu:ubuntu 0600 is accepted),
// filled by the operator, never committed:
//   CBOB_RPC_UPSTREAM=https://<provider>/?api-key=...
//   CBOB_DAS_UPSTREAM=            (optional)
//   CBOB_RPC_ORIGIN=https://centralbankofbitcoin.com
//   CBOB_RPC_PORT=8789
//   CBOB_VAULT_COLLECTION=<the address the ceremony's step 0 created>
module.exports = {
  apps: [{
    name: 'cbob-rpc-proxy',
    // Invoke Node directly. PM2's ESM import wrapper does not set argv[1] to
    // the module, so the proxy's direct-entry guard would never start listening.
    script: '/usr/bin/node',
    interpreter: 'none',
    args: ['--env-file=/etc/cbob/rpc-proxy.env', '/opt/cbob-vaults/web/deploy/rpc-proxy.mjs'],
    instances: 1,
    exec_mode: 'fork',
    max_memory_restart: '200M',
    min_uptime: '10s',
    max_restarts: 20,
    autorestart: true,
  }],
}
