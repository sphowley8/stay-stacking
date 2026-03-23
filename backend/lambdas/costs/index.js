'use strict';

const { CostExplorerClient, GetCostAndUsageCommand } = require('@aws-sdk/client-cost-explorer');
const { withAuth, response } = require('./shared/auth');

// Cost Explorer is only available in us-east-1
const ceClient = new CostExplorerClient({ region: 'us-east-1' });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return response(200, {});

  if (event.httpMethod === 'GET') {
    return withAuth(async () => {
      const today = new Date();
      const endDate = today.toISOString().slice(0, 10);

      // 90 days back — covers ~3 full calendar months
      const start = new Date(today);
      start.setDate(start.getDate() - 90);
      const startDate = start.toISOString().slice(0, 10);

      // Cost Explorer does not support WEEKLY; fetch DAILY and let frontend aggregate
      const result = await ceClient.send(new GetCostAndUsageCommand({
        TimePeriod: { Start: startDate, End: endDate },
        Granularity: 'DAILY',
        Metrics: ['UnblendedCost'],
        GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
      }));

      const serviceSet = new Set();
      const days = result.ResultsByTime.map(day => {
        const byService = {};
        for (const group of day.Groups) {
          const svc = group.Keys[0];
          serviceSet.add(svc);
          byService[svc] = parseFloat(parseFloat(group.Metrics.UnblendedCost.Amount).toFixed(4));
        }
        const total = Object.values(byService).reduce((s, v) => s + v, 0);
        return {
          date: day.TimePeriod.Start,
          total: parseFloat(total.toFixed(4)),
          byService,
        };
      });

      return response(200, { days, services: [...serviceSet] });
    })(event);
  }

  return response(405, { error: 'Method not allowed' });
};
