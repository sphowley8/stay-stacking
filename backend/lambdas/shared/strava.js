'use strict';

const https = require('https');
const { dynamo } = require('./dynamo');
const { getSecretJson } = require('./secrets');
const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');

/**
 * Makes an HTTPS request and returns parsed JSON.
 */
function httpsRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (!data) {
          resolve({ statusCode: res.statusCode, body: null });
          return;
        }
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          reject(new Error('Failed to parse Strava response'));
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

/**
 * Fetches Strava credentials from Secrets Manager (cached after first call).
 * Secret JSON format: { "client_id": "...", "client_secret": "..." }
 */
async function getStravaCredentials() {
  return getSecretJson(process.env.SECRET_STRAVA_ARN);
}

/**
 * Exchanges an OAuth authorization code for Strava tokens.
 * @returns {{ access_token, refresh_token, expires_at, athlete }}
 */
async function exchangeCode(code) {
  const { client_id, client_secret } = await getStravaCredentials();

  const postData = JSON.stringify({
    client_id,
    client_secret,
    code,
    grant_type: 'authorization_code',
  });

  const result = await httpsRequest({
    hostname: 'www.strava.com',
    path: '/oauth/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
    },
  }, postData);

  if (result.statusCode !== 200) {
    throw { statusCode: 401, message: 'Strava token exchange failed' };
  }
  return result.body;
}

/**
 * Refreshes a Strava access token and updates the user record in DynamoDB.
 * @param {object} user - { userId, refreshToken }
 * @returns {string} new access token
 */
async function refreshAccessToken(user) {
  const { client_id, client_secret } = await getStravaCredentials();

  const postData = JSON.stringify({
    client_id,
    client_secret,
    grant_type: 'refresh_token',
    refresh_token: user.refreshToken,
  });

  const result = await httpsRequest({
    hostname: 'www.strava.com',
    path: '/oauth/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
    },
  }, postData);

  if (result.statusCode !== 200) {
    throw { statusCode: 401, message: 'Strava token refresh failed' };
  }

  const { access_token, refresh_token, expires_at } = result.body;

  // Update both tokens in DynamoDB (Strava rotates refresh tokens)
  await dynamo.send(new UpdateCommand({
    TableName: process.env.USERS_TABLE,
    Key: { userId: user.userId },
    UpdateExpression: 'SET accessToken = :at, refreshToken = :rt, tokenExpiry = :te',
    ExpressionAttributeValues: {
      ':at': access_token,
      ':rt': refresh_token,
      ':te': expires_at,
    },
  }));

  return access_token;
}

/**
 * Returns a valid Strava access token, refreshing if necessary.
 * @param {object} user - { userId, accessToken, refreshToken, tokenExpiry }
 * @returns {string} valid access token
 */
async function getValidToken(user) {
  const bufferSeconds = 300; // Refresh 5 min before expiry
  if (user.tokenExpiry > Math.floor(Date.now() / 1000) + bufferSeconds) {
    return user.accessToken;
  }
  return refreshAccessToken(user);
}

/**
 * Fetches all Strava activities after a given epoch timestamp, handling pagination.
 * @param {string} accessToken
 * @param {number} afterEpoch - Unix epoch seconds
 * @returns {Array} activities
 */
async function fetchActivitiesSince(accessToken, afterEpoch) {
  const allActivities = [];
  let page = 1;

  while (true) {
    const path = `/api/v3/athlete/activities?after=${afterEpoch}&per_page=100&page=${page}`;
    const result = await httpsRequest({
      hostname: 'www.strava.com',
      path,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (result.statusCode === 401) {
      throw { statusCode: 401, message: 'Strava authorization invalid' };
    }
    if (result.statusCode !== 200) {
      throw new Error(`Strava API error: ${result.statusCode}`);
    }

    const batch = result.body;
    if (!Array.isArray(batch) || batch.length === 0) break;

    allActivities.push(...batch);
    if (batch.length < 100) break;
    page++;
  }

  return allActivities;
}

/**
 * Builds the Strava OAuth redirect URL.
 * @param {string} redirectUri
 * @returns {Promise<string>}
 */
async function buildAuthUrl(redirectUri) {
  const { client_id } = await getStravaCredentials();
  return (
    `https://www.strava.com/oauth/authorize` +
    `?client_id=${client_id}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=profile:read_all,activity:read_all,activity:write`
  );
}

/**
 * Fetches the authenticated athlete's HR zones from Strava.
 * Returns the heart_rate.zones array, or null if unavailable.
 * @param {string} accessToken
 * @returns {Array|null} zones array [{ min, max }, ...]
 */
async function fetchAthleteZones(accessToken) {
  const result = await httpsRequest({
    hostname: 'www.strava.com',
    path: '/api/v3/athlete/zones',
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (result.statusCode !== 200) return null;
  return result.body?.heart_rate?.zones || null;
}

/**
 * Fetches heartrate, time, velocity, power, and grade streams for a single activity.
 * Returns available streams; heartrate/velocity/watts/grade may be null if unavailable.
 * @param {string} accessToken
 * @param {string|number} activityId
 * @returns {{ time: number[], heartrate: number[]|null, velocity: number[]|null, watts: number[]|null, grade: number[]|null }|null}
 */
async function fetchActivityStreams(accessToken, activityId) {
  const result = await httpsRequest({
    hostname: 'www.strava.com',
    path: `/api/v3/activities/${activityId}/streams?keys=heartrate,time,velocity_smooth,watts,grade_smooth&key_by_type=true`,
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (result.statusCode !== 200) return null;
  const body = result.body;
  if (!body?.time?.data) return null;
  return {
    time: body.time.data,
    heartrate: body.heartrate?.data || null,
    velocity: body.velocity_smooth?.data || null,
    watts: body.watts?.data || null,
    grade: body.grade_smooth?.data || null,
  };
}

/**
 * Fetches the authenticated athlete's FTP from Strava.
 * Returns the ftp value (watts) or null if not set.
 * @param {string} accessToken
 * @returns {number|null}
 */
async function fetchAthleteFTP(accessToken) {
  const result = await httpsRequest({
    hostname: 'www.strava.com',
    path: '/api/v3/athlete',
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (result.statusCode !== 200) return null;
  return result.body?.ftp || null;
}

/**
 * Creates a manual activity on Strava (no GPS data).
 * @param {string} accessToken
 * @param {object} payload - { name, sport_type, start_date_local, elapsed_time, distance?, total_elevation_gain?, description? }
 * @returns {object} created activity response
 */
async function createActivity(accessToken, payload) {
  const postData = JSON.stringify(payload);
  const result = await httpsRequest({
    hostname: 'www.strava.com',
    path: '/api/v3/activities',
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
    },
  }, postData);

  if (result.statusCode === 401 || result.statusCode === 403) {
    throw new Error('reauth_required');
  }
  if (result.statusCode !== 201) {
    throw new Error(`Strava create activity failed: ${result.statusCode}`);
  }
  return result.body;
}

/**
 * Deletes an activity from Strava by its ID.
 * @param {string} accessToken
 * @param {string|number} stravaActivityId
 * @returns {boolean} true on success
 */
async function deleteActivity(accessToken, stravaActivityId) {
  const result = await httpsRequest({
    hostname: 'www.strava.com',
    path: `/api/v3/activities/${stravaActivityId}`,
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (result.statusCode === 401 || result.statusCode === 403) {
    throw new Error('reauth_required');
  }
  if (result.statusCode === 404) {
    throw new Error('not_found');
  }
  return true;
}

module.exports = { exchangeCode, getValidToken, fetchActivitiesSince, buildAuthUrl, fetchAthleteZones, fetchActivityStreams, fetchAthleteFTP, createActivity, deleteActivity };
