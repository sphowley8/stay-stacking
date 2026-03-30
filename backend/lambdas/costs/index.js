'use strict';

const { CostExplorerClient, GetCostAndUsageCommand } = require('@aws-sdk/client-cost-explorer');
const { STSClient, AssumeRoleCommand } = require('@aws-sdk/client-sts');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { withAuth, response } = require('./shared/auth');
const { dynamo } = require('./shared/dynamo');

// Cost Explorer is only available in us-east-1
const localCeClient = new CostExplorerClient({ region: 'us-east-1' });

async function getPeerClients() {
  const stsClient = new STSClient({ region: 'us-east-1' });
  const assumed = await stsClient.send(new AssumeRoleCommand({
    RoleArn: process.env.PEER_ROLE_ARN,
    RoleSessionName: 'staystacking-costs-cross-account',
    DurationSeconds: 900,
  }));
  const creds = {
    accessKeyId: assumed.Credentials.AccessKeyId,
    secretAccessKey: assumed.Credentials.SecretAccessKey,
    sessionToken: assumed.Credentials.SessionToken,
  };
  const ceClient = new CostExplorerClient({ region: 'us-east-1', credentials: creds });
  const rawDynamo = new DynamoDBClient({ region: 'us-east-1', credentials: creds });
  const dynamoClient = DynamoDBDocumentClient.from(rawDynamo, {
    marshallOptions: { removeUndefinedValues: true, convertEmptyValues: false },
  });
  return { ceClient, dynamoClient };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return response(200, {});

  if (event.httpMethod === 'GET') {
    return withAuth(async () => {
      const requestedEnv = (event.queryStringParameters || {}).env || process.env.ENVIRONMENT;
      const isPeer = requestedEnv !== process.env.ENVIRONMENT;

      const today = new Date();
      const endDate = today.toISOString().slice(0, 10);
      const start = new Date(today);
      start.setMonth(start.getMonth() - 12);
      start.setDate(1);
      const startDate = start.toISOString().slice(0, 10);

      let ceClient = localCeClient;
      let dynamoClient = dynamo;
      let usersTable = process.env.USERS_TABLE;

      if (isPeer) {
        const peer = await getPeerClients();
        ceClient = peer.ceClient;
        dynamoClient = peer.dynamoClient;
        usersTable = process.env.PEER_USERS_TABLE;
      }

      const [ceResult, usersResult] = await Promise.all([
        ceClient.send(new GetCostAndUsageCommand({
          TimePeriod: { Start: startDate, End: endDate },
          Granularity: 'MONTHLY',
          Metrics: ['UnblendedCost'],
          GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
        })),
        dynamoClient.send(new ScanCommand({
          TableName: usersTable,
          ProjectionExpression: 'userId, stravaId, firstName, lastName, lastSynced',
        })),
      ]);

      const serviceSet = new Set();
      const months = ceResult.ResultsByTime.map(month => {
        const byService = {};
        for (const group of month.Groups) {
          const svc = group.Keys[0];
          serviceSet.add(svc);
          byService[svc] = parseFloat(parseFloat(group.Metrics.UnblendedCost.Amount).toFixed(2));
        }
        const total = Object.values(byService).reduce((s, v) => s + v, 0);
        return {
          month: month.TimePeriod.Start.slice(0, 7), // YYYY-MM
          total: parseFloat(total.toFixed(2)),
          byService,
        };
      });

      const users = (usersResult.Items || []).map(u => ({
        userId: u.userId,
        stravaId: u.stravaId,
        firstName: u.firstName || null,
        lastName: u.lastName || null,
        lastSynced: u.lastSynced || null,
      }));

      return response(200, { months, services: [...serviceSet], users });
    })(event);
  }

  return response(405, { error: 'Method not allowed' });
};
