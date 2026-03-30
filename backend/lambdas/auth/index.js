'use strict';

const { v4: uuidv4 } = require('uuid');
const { QueryCommand, PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { dynamo } = require('./shared/dynamo');
const { exchangeCode, buildAuthUrl } = require('./shared/strava');
const { signToken, response } = require('./shared/auth');

exports.handler = async (event) => {
  const path = event.path || '';
  const method = event.httpMethod;

  // GET /auth/strava — redirect to Strava OAuth
  if (path.endsWith('/auth/strava') && method === 'GET') {
    try {
      const apiUrl = `https://${event.requestContext.domainName}/${event.requestContext.stage}`;
      const redirectUri = `${apiUrl}/auth/callback`;
      const stravaUrl = await buildAuthUrl(redirectUri);

      return {
        statusCode: 302,
        headers: { Location: stravaUrl },
        body: '',
      };
    } catch (err) {
      console.error('Auth strava redirect error:', err);
      return {
        statusCode: 302,
        headers: { Location: `${process.env.FRONTEND_URL || '/'}/#error=config_error` },
        body: '',
      };
    }
  }

  // GET /auth/callback — exchange code, issue JWT, redirect to frontend
  if (path.endsWith('/auth/callback') && method === 'GET') {
    const params = event.queryStringParameters || {};

    if (params.error) {
      return {
        statusCode: 302,
        headers: { Location: `${process.env.FRONTEND_URL}/#error=access_denied` },
        body: '',
      };
    }

    if (!params.code) {
      return {
        statusCode: 302,
        headers: { Location: `${process.env.FRONTEND_URL}/#error=missing_code` },
        body: '',
      };
    }

    try {
      // Exchange authorization code for tokens
      const tokenData = await exchangeCode(params.code);
      const { access_token, refresh_token, expires_at, athlete } = tokenData;
      const stravaId = athlete.id;

      // Look up existing user by Strava ID
      const queryResult = await dynamo.send(new QueryCommand({
        TableName: process.env.USERS_TABLE,
        IndexName: 'stravaId-index',
        KeyConditionExpression: 'stravaId = :sid',
        ExpressionAttributeValues: { ':sid': stravaId },
        Limit: 1,
      }));

      let userId;

      if (queryResult.Items && queryResult.Items.length > 0) {
        // Existing user — update tokens and name
        userId = queryResult.Items[0].userId;
        await dynamo.send(new UpdateCommand({
          TableName: process.env.USERS_TABLE,
          Key: { userId },
          UpdateExpression: 'SET accessToken = :at, refreshToken = :rt, tokenExpiry = :te, firstName = :fn, lastName = :ln',
          ExpressionAttributeValues: {
            ':at': access_token,
            ':rt': refresh_token,
            ':te': expires_at,
            ':fn': athlete.firstname || '',
            ':ln': athlete.lastname || '',
          },
        }));
      } else {
        // New user — create record
        userId = uuidv4();
        await dynamo.send(new PutCommand({
          TableName: process.env.USERS_TABLE,
          Item: {
            userId,
            stravaId,
            firstName: athlete.firstname || '',
            lastName: athlete.lastname || '',
            accessToken: access_token,
            refreshToken: refresh_token,
            tokenExpiry: expires_at,
            injuryActive: false,
            createdAt: new Date().toISOString(),
          },
        }));
      }

      const token = await signToken(userId, stravaId);

      return {
        statusCode: 302,
        headers: { Location: `${process.env.FRONTEND_URL}/#token=${token}` },
        body: '',
      };
    } catch (err) {
      console.error('Auth callback error:', err);
      return {
        statusCode: 302,
        headers: { Location: `${process.env.FRONTEND_URL}/#error=auth_failed` },
        body: '',
      };
    }
  }

  return response(404, { error: 'Not found' });
};
