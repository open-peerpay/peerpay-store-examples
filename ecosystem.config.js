module.exports = {
  apps: [
    {
      name: "peerpay-store",
      script: "./peerpay-store",
      cwd: "/home/peerpay-store",
      exec_interpreter: "none",
      instances: 1,
      autorestart: true,
      env: {
        NODE_ENV: "production",
        PORT: "3000"
      }
    }
  ]
};
