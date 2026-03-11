const pino = require("pino");

function resolveTransport() {
  if (process.env.NODE_ENV === "production") {
    return undefined;
  }

  try {
    require.resolve("pino-pretty");
    return {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
        ignore: "pid,hostname"
      }
    };
  } catch (_error) {
    return undefined;
  }
}

const rootLogger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "authorization",
      "password",
      "token",
      "cookies",
      "storageState"
    ],
    censor: "[redacted]"
  },
  transport: resolveTransport()
});

function createLogger(scope) {
  return rootLogger.child({ scope });
}

module.exports = {
  createLogger
};
