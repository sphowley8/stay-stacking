'use strict';

const { GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { dynamo } = require('./shared/dynamo');
const { withAuth, response } = require('./shared/auth');

exports.handler = async (event) => {
  const method = event.httpMethod;

  if (method === 'OPTIONS') {
    return response(200, {});
  }

  // GET /user — return current user profile
  if (method === 'GET') {
    return withAuth(async (event, userId) => {
      const result = await dynamo.send(new GetCommand({
        TableName: process.env.USERS_TABLE,
        Key: { userId },
      }));

      if (!result.Item) {
        return response(404, { error: 'User not found' });
      }

      const user = result.Item;
      const now = Math.floor(Date.now() / 1000);

      return response(200, {
        userId: user.userId,
        stravaId: user.stravaId,
        injuryActive: user.injuryActive || false,
        hasValidToken: !!user.tokenExpiry && user.tokenExpiry > now,
        createdAt: user.createdAt,
        hrZones: user.hrZones || null,
        ftp: user.ftp || null,
        vdot: user.vdot || null,
        vdotThresholds: user.vdotThresholds || null,
      });
    })(event);
  }

  // POST /user — update user settings (injuryActive and/or ftp)
  if (method === 'POST') {
    return withAuth(async (event, userId) => {
      const body = JSON.parse(event.body || '{}');

      const exprParts = [];
      const exprValues = {};
      const updated = {};

      if (typeof body.injuryActive === 'boolean') {
        exprParts.push('injuryActive = :ia');
        exprValues[':ia'] = body.injuryActive;
        updated.injuryActive = body.injuryActive;
      }

      if (typeof body.ftp === 'number' && body.ftp > 0) {
        exprParts.push('ftp = :f');
        exprValues[':f'] = Math.round(body.ftp);
        updated.ftp = Math.round(body.ftp);
      }

      if (typeof body.vdot === 'number' && body.vdot > 0) {
        exprParts.push('vdot = :vd');
        exprValues[':vd'] = parseFloat(body.vdot.toFixed(1));
        updated.vdot = parseFloat(body.vdot.toFixed(1));
      }

      if (Array.isArray(body.vdotThresholds) && body.vdotThresholds.length === 6 &&
          body.vdotThresholds.every(v => typeof v === 'number' && v > 0)) {
        exprParts.push('vdotThresholds = :vt');
        exprValues[':vt'] = body.vdotThresholds;
        updated.vdotThresholds = body.vdotThresholds;
      }

      if (exprParts.length === 0) {
        return response(400, { error: 'No valid fields to update' });
      }

      await dynamo.send(new UpdateCommand({
        TableName: process.env.USERS_TABLE,
        Key: { userId },
        UpdateExpression: `SET ${exprParts.join(', ')}`,
        ExpressionAttributeValues: exprValues,
      }));

      return response(200, updated);
    })(event);
  }

  return response(405, { error: 'Method not allowed' });
};
