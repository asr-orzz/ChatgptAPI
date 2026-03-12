class ManualLoginRequiredError extends Error {
  constructor(message) {
    super(message);
    this.name = "ManualLoginRequiredError";
  }
}

class CloudflareChallengeError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "CloudflareChallengeError";
    this.headless = Boolean(options.headless);
  }
}

module.exports = {
  CloudflareChallengeError,
  ManualLoginRequiredError
};
