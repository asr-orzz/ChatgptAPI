function getConfiguredApiToken() {
  return (process.env.API_BEARER_TOKEN || "").trim();
}

function extractProvidedToken(req) {
  const authorization = String(req.headers.authorization || "");
  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }

  const apiKeyHeader = req.headers["x-api-key"];
  if (typeof apiKeyHeader === "string") {
    return apiKeyHeader.trim();
  }

  return "";
}

function isApiTokenEnabled() {
  return Boolean(getConfiguredApiToken());
}

function requireApiToken(req, res, next) {
  const configuredToken = getConfiguredApiToken();

  if (!configuredToken) {
    next();
    return;
  }

  const providedToken = extractProvidedToken(req);
  if (providedToken && providedToken === configuredToken) {
    next();
    return;
  }

  res.status(401).json({
    ok: false,
    error: "Unauthorized. Provide the configured bearer token."
  });
}

module.exports = {
  extractProvidedToken,
  getConfiguredApiToken,
  isApiTokenEnabled,
  requireApiToken
};
