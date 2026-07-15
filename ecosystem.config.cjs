const nodeInterpreter = process.env.NVM_BIN ? `${process.env.NVM_BIN}/node` : "node";

module.exports = {
  apps: [{
    name: "nkriz-workspace-backend",
    cwd: __dirname,
    script: "apps/api/dist/server.js",
    interpreter: nodeInterpreter,
    instances: 1,
    exec_mode: "fork",
    autorestart: true,
    watch: false,
    max_memory_restart: "1G",
    kill_timeout: 10000,
    listen_timeout: 10000,
    exp_backoff_restart_delay: 250,
    merge_logs: true,
    time: true,
    env: {
      NODE_ENV: "production",
      HOST: "0.0.0.0",
      PORT: "3014"
    }
  }]
};
