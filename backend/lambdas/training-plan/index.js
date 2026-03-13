'use strict';

const { QueryCommand, PutCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { dynamo } = require('./shared/dynamo');
const { withAuth, response } = require('./shared/auth');

exports.handler = async (event) => {
  const method = event.httpMethod;
  const pathParams = event.pathParameters || {};

  if (method === 'OPTIONS') {
    return response(200, {});
  }

  // GET /training-plan?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
  if (method === 'GET') {
    return withAuth(async (event, userId) => {
      const params = event.queryStringParameters || {};

      // Default: current week start to 6 weeks from now
      const today = new Date();
      const defaultStart = getMonday(today);
      const defaultEnd = new Date(defaultStart);
      defaultEnd.setUTCDate(defaultEnd.getUTCDate() + 41); // 6 weeks = 42 days (0-41)

      const startDate = params.startDate || defaultStart.toISOString().split('T')[0];
      const endDate = params.endDate || defaultEnd.toISOString().split('T')[0];

      const result = await dynamo.send(new QueryCommand({
        TableName: process.env.TRAINING_PLAN_TABLE,
        KeyConditionExpression: 'userId = :uid AND #date BETWEEN :start AND :end',
        ExpressionAttributeNames: { '#date': 'date' },
        ExpressionAttributeValues: {
          ':uid': userId,
          ':start': startDate,
          ':end': endDate,
        },
      }));

      return response(200, { entries: result.Items || [], startDate, endDate });
    })(event);
  }

  // POST /training-plan/{date} — create or replace a plan entry
  if (method === 'POST') {
    return withAuth(async (event, userId) => {
      const date = pathParams.date;
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return response(400, { error: 'Invalid date format. Use YYYY-MM-DD' });
      }

      const body = JSON.parse(event.body || '{}');

      await dynamo.send(new PutCommand({
        TableName: process.env.TRAINING_PLAN_TABLE,
        Item: {
          userId,
          date,
          distance: typeof body.distance === 'number' ? body.distance : 0,
          elevation: typeof body.elevation === 'number' ? body.elevation : 0,
          time: typeof body.time === 'number' ? body.time : 0,
          updatedAt: new Date().toISOString(),
        },
      }));

      return response(200, { date, saved: true });
    })(event);
  }

  // DELETE /training-plan/{date} — remove a plan entry
  if (method === 'DELETE') {
    return withAuth(async (event, userId) => {
      const date = pathParams.date;
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return response(400, { error: 'Invalid date format. Use YYYY-MM-DD' });
      }

      await dynamo.send(new DeleteCommand({
        TableName: process.env.TRAINING_PLAN_TABLE,
        Key: { userId, date },
      }));

      return response(200, { date, deleted: true });
    })(event);
  }

  return response(405, { error: 'Method not allowed' });
};

function getMonday(date) {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}
