'use strict';

const jwt = require('jsonwebtoken');
const { getSecret } = require('./secrets');

/**
 * Verifies the JWT from the Authorization header and returns the userId.
 * Fetches the JWT secret from Secrets Manager (cached after first call).
 *
 * @param {string|undefined} authHeader - "Bearer <token>"
 * @returns {Promise<string>} userId
 */
async function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw { statusCode: 401, message: 'Missing or invalid Authorization header' };
  }
  const token = authHeader.slice(7);
  try {
    const secret = await getSecret(process.env.SECRET_JWT_ARN);
    const decoded = jwt.verify(token, secret);
    return decoded.userId;
  } catch (err) {
    if (err.statusCode) throw err;
    throw { statusCode: 401, message: 'Invalid or expired token' };
  }
}

/**
 * Signs a new JWT for a user.
 * Fetches the JWT secret from Secrets Manager (cached after first call).
 *
 * @param {string} userId
 * @param {number|string} stravaId
 * @returns {Promise<string>} JWT token
 */
async function signToken(userId, stravaId) {
  const secret = await getSecret(process.env.SECRET_JWT_ARN);
  return jwt.sign(
    { userId, stravaId },
    secret,
    { expiresIn: '30d' }
  );
}

/**
 * Builds a standard API Gateway response.
 */
function response(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': process.env.FRONTEND_URL || '*',
      'Access-Control-Allow-Headers': 'Authorization,Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

/**
 * Wraps a Lambda handler with JWT auth and error handling.
 * The handler receives (event, userId).
 */
function withAuth(handler) {
  return async (event) => {
    try {
      const userId = await verifyToken(event.headers?.Authorization || event.headers?.authorization);
      return await handler(event, userId);
    } catch (err) {
      if (err.statusCode) {
        return response(err.statusCode, { error: err.message });
      }
      console.error('Unhandled error:', err);
      return response(500, { error: 'Internal server error' });
    }
  };
}

/**
 * Wraps a public Lambda handler with error handling (no auth).
 */
function withErrorHandling(handler) {
  return async (event) => {
    try {
      return await handler(event);
    } catch (err) {
      if (err.statusCode) {
        return response(err.statusCode, { error: err.message });
      }
      console.error('Unhandled error:', err);
      return response(500, { error: 'Internal server error' });
    }
  };
}

module.exports = { verifyToken, signToken, response, withAuth, withErrorHandling };
