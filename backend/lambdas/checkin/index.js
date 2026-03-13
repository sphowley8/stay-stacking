'use strict';

const { QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { dynamo } = require('./shared/dynamo');
const { withAuth, response } = require('./shared/auth');

exports.handler = async (event) => {
  const method = event.httpMethod;

  if (method === 'OPTIONS') {
    return response(200, {});
  }

  // GET /checkin?days=8 — return recent check-ins
  if (method === 'GET') {
    return withAuth(async (event, userId) => {
      const days = parseInt(event.queryStringParameters?.days || '8', 10);

      // Build start date (N days ago)
      const startDate = new Date();
      startDate.setUTCDate(startDate.getUTCDate() - (days - 1));
      const startDateStr = startDate.toISOString().split('T')[0];
      const todayStr = new Date().toISOString().split('T')[0];

      const result = await dynamo.send(new QueryCommand({
        TableName: process.env.CHECKINS_TABLE,
        KeyConditionExpression: 'userId = :uid AND #date BETWEEN :start AND :end',
        ExpressionAttributeNames: { '#date': 'date' },
        ExpressionAttributeValues: {
          ':uid': userId,
          ':start': startDateStr,
          ':end': todayStr,
        },
      }));

      return response(200, { checkins: result.Items || [] });
    })(event);
  }

  // POST /checkin — create or update a check-in (morning or evening)
  if (method === 'POST') {
    return withAuth(async (event, userId) => {
      const body = JSON.parse(event.body || '{}');
      const date = body.date || new Date().toISOString().split('T')[0];

      // Build UpdateExpression dynamically — only set provided fields
      const ALLOWED_FIELDS = [
        'morningStiffness',
        'morningPain',
        'tenderToTouch',
        'archFeels',
        'eveningPain',
        'fatigue',
        'recoveryTools',
      ];

      const updates = [];
      const exprValues = { ':updatedAt': new Date().toISOString() };
      const exprNames = {};

      for (const field of ALLOWED_FIELDS) {
        if (body[field] !== undefined) {
          const placeholder = `:${field}`;
          updates.push(`#${field} = ${placeholder}`);
          exprValues[placeholder] = body[field];
          exprNames[`#${field}`] = field;
        }
      }

      if (updates.length === 0) {
        return response(400, { error: 'No valid fields provided' });
      }

      updates.push('updatedAt = :updatedAt');

      await dynamo.send(new UpdateCommand({
        TableName: process.env.CHECKINS_TABLE,
        Key: { userId, date },
        UpdateExpression: `SET ${updates.join(', ')}`,
        ExpressionAttributeValues: exprValues,
        ExpressionAttributeNames: Object.keys(exprNames).length > 0 ? exprNames : undefined,
      }));

      return response(200, { date, updated: true });
    })(event);
  }

  return response(405, { error: 'Method not allowed' });
};
