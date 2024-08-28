module.exports = {
  apps : [{
    name: 'bot_cx',
    time: true,
    script: 'bot_cx.js',
    instances: 1,
    autorestart: false,
    watch: false,
    env: {
      NODE_ENV: "production",
    },
  }]
};
