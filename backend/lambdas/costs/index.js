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

      // 12 weeks back (84 days), snapped to the nearest Monday for clean weekly buckets
      const start = new Date(today);
      start.setDate(start.getDate() - 84);
      const startDate = start.toISOString().slice(0, 10);

      // Fetch daily data (Cost Explorer does not support WEEKLY granularity)
      const result = await ceClient.send(new GetCostAndUsageCommand({
        TimePeriod: { Start: startDate, End: endDate },
        Granularity: 'DAILY',
        Metrics: ['UnblendedCost'],
        GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
      }));

      // Roll daily results up into Monday-anchored weeks
      const weekMap = new Map(); // key: Monday date string
      const serviceSet = new Set();

      for (const day of result.ResultsByTime) {
        const d = new Date(day.TimePeriod.Start + 'T00:00:00Z');
        // Find the Monday of this day's week (0=Sun, 1=Mon)
        const dayOfWeek = d.getUTCDay();
        const diff = (dayOfWeek === 0) ? -6 : 1 - dayOfWeek;
        const monday = new Date(d);
        monday.setUTCDate(d.getUTCDate() + diff);
        const weekKey = monday.toISOString().slice(0, 10);

        if (!weekMap.has(weekKey)) weekMap.set(weekKey, {});
        const bucket = weekMap.get(weekKey);

        for (const group of day.Groups) {
          const svc = group.Keys[0];
          serviceSet.add(svc);
          bucket[svc] = (bucket[svc] || 0) + parseFloat(group.Metrics.UnblendedCost.Amount);
        }
      }

      const weeks = [...weekMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([weekStart, byCost]) => {
          // Round service values
          const rounded = {};
          for (const [svc, v] of Object.entries(byCost)) rounded[svc] = parseFloat(v.toFixed(4));
          const total = Object.values(rounded).reduce((s, v) => s + v, 0);
          return { start: weekStart, total: parseFloat(total.toFixed(4)), byService: rounded };
        });

      return response(200, { weeks, services: [...serviceSet] });
    })(event);
  }

  return response(405, { error: 'Method not allowed' });
};
