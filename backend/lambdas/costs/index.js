'use strict';

const { CostExplorerClient, GetCostAndUsageCommand } = require('@aws-sdk/client-ce');
const { withAuth, response } = require('./shared/auth');

// Cost Explorer is only available in us-east-1
const ceClient = new CostExplorerClient({ region: 'us-east-1' });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return response(200, {});

  if (event.httpMethod === 'GET') {
    return withAuth(async () => {
      const today = new Date();
      const endDate = today.toISOString().slice(0, 10);

      // 12 weeks back (84 days), snapped to the nearest Monday for clean weekly buckets
      const start = new Date(today);
      start.setDate(start.getDate() - 84);
      const startDate = start.toISOString().slice(0, 10);

      const result = await ceClient.send(new GetCostAndUsageCommand({
        TimePeriod: { Start: startDate, End: endDate },
        Granularity: 'WEEKLY',
        Metrics: ['UnblendedCost'],
        GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
      }));

      // Collect all service names across all weeks
      const serviceSet = new Set();
      for (const week of result.ResultsByTime) {
        for (const group of week.Groups) {
          serviceSet.add(group.Keys[0]);
        }
      }

      // Build a flat week-by-week structure
      const weeks = result.ResultsByTime.map(week => {
        const byCost = {};
        for (const group of week.Groups) {
          const svc = group.Keys[0];
          byCost[svc] = parseFloat(group.Metrics.UnblendedCost.Amount);
        }
        const total = Object.values(byCost).reduce((s, v) => s + v, 0);
        return {
          start: week.TimePeriod.Start,
          end:   week.TimePeriod.End,
          total: parseFloat(total.toFixed(4)),
          byService: byCost,
        };
      });

      return response(200, { weeks, services: [...serviceSet] });
    })(event);
  }

  return response(405, { error: 'Method not allowed' });
};
