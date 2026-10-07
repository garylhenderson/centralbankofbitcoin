// PM2 definition for the RPC proxy. STAGED, NOT INSTALLED (web/README.md).
// The env file is owned by the user PM2 runs the proxy as (ubuntu), mode 600,
// filled by the operator, never committed:
//   CBOB_RPC_UPSTREAM=https://<provider>/?api-key=...
//   CBOB_DAS_UPSTREAM=            (optional)
//   CBOB_RPC_ORIGIN=https://centralbankofbitcoin.com
//   CBOB_RPC_PORT=8789
//   CBOB_VAULT_COLLECTION=<the address the ceremony's step 0 created>
module.exports = {
  apps: [{
    name: 'cbob-rpc-proxy',
    script: '/opt/cbob-vaults/web/deploy/rpc-proxy.mjs',
    node_args: '--env-file=/etc/cbob/rpc-proxy.env',
    instances: 1,
    exec_mode: 'fork',
    max_memory_restart: '200M',
    min_uptime: '10s',
    max_restarts: 20,
    autorestart: true,
  }],
}
