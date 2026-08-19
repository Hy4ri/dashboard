module.exports = {
  apps: [{
    name: 'dashboard',
    script: './monit-server',
    instances: 1,
    exec_mode: 'fork',
    env: {
      PORT: 8080,
    },
    watch: false,
    max_memory_restart: '100M',
    restart_delay: 3000
  }]
};
