'use strict';

const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });

// Module-level cache — persists across warm Lambda invocations (one fetch per cold start)
const cache = {};

/**
 * Fetches a secret string from AWS Secrets Manager.
 * Caches the result for the lifetime of the Lambda container.
 *
 * @param {string} secretArn - Full ARN of the secret
 * @returns {Promise<string>} The secret string value
 */
async function getSecret(secretArn) {
  if (cache[secretArn]) return cache[secretArn];

  const response = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
  const value = response.SecretString;
  cache[secretArn] = value;
  return value;
}

/**
 * Fetches and parses a JSON secret from Secrets Manager.
 * @param {string} secretArn
 * @returns {Promise<object>}
 */
async function getSecretJson(secretArn) {
  const raw = await getSecret(secretArn);
  return JSON.parse(raw);
}

module.exports = { getSecret, getSecretJson };
