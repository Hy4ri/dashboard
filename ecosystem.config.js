module.exports = {
  apps: [{
    name: 'dashboard',
    script: './server.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      PORT: 8080,
      NODE_ENV: 'production',
      QB_USER: 'admin',
      QB_PASS: 'SET_YOUR_QBITTORRENT_PASSWORD',
      API_KEY: 'SET_YOUR_API_KEY',
    },
    watch: false,
    max_memory_restart: '100M',
    restart_delay: 3000
  }]
};
