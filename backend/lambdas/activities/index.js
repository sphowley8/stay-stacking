'use strict';

const { GetCommand, PutCommand, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { BatchGetCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { dynamo } = require('./shared/dynamo');
const { withAuth, response } = require('./shared/auth');
const { getValidToken, fetchActivitiesSince, fetchAthleteZones, fetchActivityStreams, fetchAthleteFTP } = require('./shared/strava');
const { getWeekStart, getWeekStartNWeeksAgo } = require('./shared/weekStart');

// 8-week TTL in seconds
const EIGHT_WEEKS_SECONDS = 56 * 24 * 60 * 60;

// Pace zone thresholds in m/s derived from Daniels VDOT 57 (17:45 5K)
// Boundaries: Easy=7:18/mi, Marathon=6:29/mi, HM=6:13/mi, 10K=5:56/mi, 5K=5:43/mi, Mile=5:10/mi
// 7 buckets: [Recovery, Steady State, Marathon, Half Marathon, 10K, 5K, Fast]
const PACE_THRESHOLDS_MS = [3.674, 4.137, 4.320, 4.520, 4.695, 5.191];

// Coggan power zone thresholds as fraction of FTP
// 7 zones: [<55%, 55-75%, 75-90%, 90-105%, 105-120%, 120-150%, >150%]
const POWER_ZONE_PCTS = [0.55, 0.75, 0.90, 1.05, 1.20, 1.50];

// Gradient zone absolute-grade thresholds in percent
// 4 buckets by |grade|: [Flat (<2%), Easy Hill (2-5%), Steep Hill (5-12%), Power Hike (>12%)]
const GRADE_ABS_THRESHOLDS = [2, 5, 12];

function normalizeActivityType(stravaType) {
  if (stravaType === 'Ride' || stravaType === 'VirtualRide') return 'Cycling';
  if (stravaType === 'Snowboard' || stravaType === 'BackcountrySki') return 'Snow Sports';
  return stravaType || 'Unknown';
}

/**
 * Given parallel time and heartrate arrays and Strava HR zones,
 * returns seconds spent in each zone [z1, z2, z3, z4, z5].
 * Last zone is treated as unbounded above.
 */
// hrBias: add this many BPM before zone assignment (e.g. +13 for cycling to correct for lower cycling HR)
// minHr:  ignore samples at or below this raw BPM (e.g. 80 to filter out resting/artifact readings)
function computeZoneTimes(timeStream, hrStream, zones, { hrBias = 0, minHr = 0 } = {}) {
  const result = [0, 0, 0, 0, 0];
  if (!timeStream || !hrStream || timeStream.length < 2 || !zones || zones.length === 0) {
    return result;
  }
  const n = Math.min(timeStream.length, hrStream.length);
  for (let i = 0; i < n - 1; i++) {
    const dt = timeStream[i + 1] - timeStream[i];
    const rawHr = hrStream[i];
    if (rawHr <= minHr) continue; // filter resting/artifact samples
    const hr = rawHr + hrBias;
    // Find highest zone whose min <= hr (last zone unbounded above)
    let zoneIdx = 0;
    for (let z = zones.length - 1; z >= 0; z--) {
      if (hr >= zones[z].min) {
        zoneIdx = z;
        break;
      }
    }
    if (zoneIdx < result.length) result[zoneIdx] += dt;
  }
  return result;
}

/**
 * Given parallel time and velocity_smooth arrays and a thresholds array (6 m/s values),
 * returns seconds in each of 7 pace buckets [Recovery, Steady State, Marathon, Half Marathon, 10K, 5K, Fast].
 * Falls back to hardcoded VDOT-57 thresholds if none provided.
 */
function computePaceZones(timeStream, velocityStream, thresholds) {
  const result = [0, 0, 0, 0, 0, 0, 0];
  const thr = (Array.isArray(thresholds) && thresholds.length === 6) ? thresholds : PACE_THRESHOLDS_MS;
  if (!timeStream || !velocityStream || timeStream.length < 2) return result;
  const n = Math.min(timeStream.length, velocityStream.length);
  for (let i = 0; i < n - 1; i++) {
    const dt = timeStream[i + 1] - timeStream[i];
    const v = velocityStream[i];
    let bucket = thr.length; // default: fastest bucket
    for (let t = 0; t < thr.length; t++) {
      if (v < thr[t]) { bucket = t; break; }
    }
    result[bucket] += dt;
  }
  return result;
}

/**
 * Given parallel time and grade_smooth arrays,
 * returns seconds in each of 4 gradient buckets by absolute grade:
 * [Flat (<2%), Easy Hill (2-5%), Steep Hill (5-12%), Power Hike (>12%)]
 */
function computeGradeZones(timeStream, gradeStream) {
  const result = [0, 0, 0, 0];
  if (!timeStream || !gradeStream || timeStream.length < 2) return result;
  const n = Math.min(timeStream.length, gradeStream.length);
  for (let i = 0; i < n - 1; i++) {
    const dt = timeStream[i + 1] - timeStream[i];
    const abs = Math.abs(gradeStream[i]);
    let bucket = GRADE_ABS_THRESHOLDS.length; // default: Power Hike
    for (let t = 0; t < GRADE_ABS_THRESHOLDS.length; t++) {
      if (abs < GRADE_ABS_THRESHOLDS[t]) { bucket = t; break; }
    }
    result[bucket] += dt;
  }
  return result;
}

/**
 * Given parallel time and watts arrays and athlete FTP,
 * returns seconds in each of 7 Coggan power zones.
 */
function computePowerZones(timeStream, wattsStream, ftp) {
  const result = [0, 0, 0, 0, 0, 0, 0];
  if (!timeStream || !wattsStream || timeStream.length < 2 || !ftp) return result;
  const thresholds = POWER_ZONE_PCTS.map(pct => pct * ftp);
  const n = Math.min(timeStream.length, wattsStream.length);
  for (let i = 0; i < n - 1; i++) {
    const dt = timeStream[i + 1] - timeStream[i];
    const w = wattsStream[i];
    let zone = thresholds.length; // default: highest zone
    for (let t = 0; t < thresholds.length; t++) {
      if (w < thresholds[t]) { zone = t; break; }
    }
    result[zone] += dt;
  }
  return result;
}

/**
 * Checks if a stored activity record has all applicable zone data computed.
 * HR zones: must have at least one non-zero value (guards against pre-scope-fix all-zero records).
 * Pace zones (Run only): field must exist as an array AND have been computed with the same thresholds.
 * Power zones (Cycling only): field must exist as an array.
 */
function isFullyProcessed(stored, rawType, currentPaceThresholds) {
  if (!stored) return false;
  if (!Array.isArray(stored.hrZones) || !stored.hrZones.some(v => v > 0)) return false;
  const normalizedType = normalizeActivityType(rawType);
  if (normalizedType === 'Run') {
    if (!Array.isArray(stored.paceZones) || stored.paceZones.length !== 7) return false;
    if (!Array.isArray(stored.gradeZones) || stored.gradeZones.length !== 4) return false;
    // Force recompute if thresholds changed since this activity was last stored
    const storedThr = stored.paceZoneThresholds;
    if (!Array.isArray(storedThr) ||
        storedThr.some((v, i) => Math.abs(v - currentPaceThresholds[i]) > 0.001)) {
      return false;
    }
  }
  if (normalizedType === 'Cycling' && !Array.isArray(stored.powerZones)) return false;
  return true;
}

exports.handler = async (event) => {
  const method = event.httpMethod;
  const path = event.path || '';

  if (method === 'OPTIONS') {
    return response(200, {});
  }

  // POST /activities/sync — fetch from Strava, store in DynamoDB
  if (method === 'POST' && path.includes('/sync')) {
    return withAuth(async (event, userId) => {
      // Fetch user record to get tokens + cached HR zones / FTP
      const userResult = await dynamo.send(new GetCommand({
        TableName: process.env.USERS_TABLE,
        Key: { userId },
      }));

      if (!userResult.Item) {
        return response(404, { error: 'User not found' });
      }

      const user = userResult.Item;
      const accessToken = await getValidToken(user);

      // Fetch and store the athlete's HR zones (cached on user record for future syncs)
      let hrZones = user.hrZones || null;
      try {
        const freshZones = await fetchAthleteZones(accessToken);
        if (freshZones) {
          hrZones = freshZones;
          await dynamo.send(new UpdateCommand({
            TableName: process.env.USERS_TABLE,
            Key: { userId },
            UpdateExpression: 'SET hrZones = :z',
            ExpressionAttributeValues: { ':z': freshZones },
          }));
        }
      } catch (e) {
        console.warn('Could not fetch athlete HR zones:', e.message);
      }

      // Read user-configured VDOT pace thresholds (set via POST /user from the frontend)
      const paceThresholds = user.vdotThresholds || null;
      const effectivePaceThresholds = paceThresholds || PACE_THRESHOLDS_MS;

      // Fetch and store the athlete's FTP (cached on user record for future syncs)
      let ftp = user.ftp || null;
      try {
        const freshFtp = await fetchAthleteFTP(accessToken);
        if (freshFtp !== null) {
          ftp = freshFtp;
          await dynamo.send(new UpdateCommand({
            TableName: process.env.USERS_TABLE,
            Key: { userId },
            UpdateExpression: 'SET ftp = :f',
            ExpressionAttributeValues: { ':f': freshFtp },
          }));
        }
      } catch (e) {
        console.warn('Could not fetch athlete FTP:', e.message);
      }

      // Fetch activities from last 8 weeks
      const eightWeeksAgoEpoch = Math.floor(Date.now() / 1000) - EIGHT_WEEKS_SECONDS;
      const activities = await fetchActivitiesSince(accessToken, eightWeeksAgoEpoch);

      const stravaIds = new Set(activities.map(a => String(a.id)));

      // Delete any stored activities that no longer exist in Strava
      // (covers deletions and edits that move an activity outside the window)
      const eightWeeksAgoMonday = getWeekStartNWeeksAgo(8);
      const storedResult = await dynamo.send(new QueryCommand({
        TableName: process.env.ACTIVITIES_TABLE,
        IndexName: 'userId-weekStart-index',
        KeyConditionExpression: 'userId = :uid AND weekStart >= :minWeek',
        ExpressionAttributeValues: { ':uid': userId, ':minWeek': eightWeeksAgoMonday },
        ProjectionExpression: 'activityId',
      }));
      const toDelete = (storedResult.Items || []).filter(item => !stravaIds.has(item.activityId));
      const BATCH_DELETE_SIZE = 25; // DynamoDB BatchWrite max
      for (let i = 0; i < toDelete.length; i += BATCH_DELETE_SIZE) {
        await dynamo.send(new BatchWriteCommand({
          RequestItems: {
            [process.env.ACTIVITIES_TABLE]: toDelete.slice(i, i + BATCH_DELETE_SIZE).map(item => ({
              DeleteRequest: { Key: { userId, activityId: item.activityId } },
            })),
          },
        }));
      }

      if (activities.length === 0) {
        return response(200, { synced: 0, deleted: toDelete.length });
      }

      // Batch-check which activities are already fully processed to avoid
      // re-fetching Strava streams (rate limit: 100 req/15min) on subsequent syncs.
      // DynamoDB BatchGet max is 100 keys per request.
      const BATCH_SIZE = 100;
      const existingZoneData = {}; // activityId -> stored item fields
      for (let i = 0; i < activities.length; i += BATCH_SIZE) {
        const batch = activities.slice(i, i + BATCH_SIZE);
        const batchResult = await dynamo.send(new BatchGetCommand({
          RequestItems: {
            [process.env.ACTIVITIES_TABLE]: {
              Keys: batch.map(a => ({ userId, activityId: String(a.id) })),
              ProjectionExpression: 'activityId, activityType, hrZones, paceZones, paceZoneThresholds, powerZones, gradeZones',
            },
          },
        }));
        for (const item of (batchResult.Responses?.[process.env.ACTIVITIES_TABLE] || [])) {
          existingZoneData[item.activityId] = item;
        }
      }

      // Store each activity, fetching streams only for new/unprocessed activities
      let syncCount = 0;
      for (const activity of activities) {
        const dateStr = activity.start_date_local
          ? activity.start_date_local.split('T')[0]
          : activity.start_date.split('T')[0];

        const weekStart = getWeekStart(dateStr);
        const ttl = Math.floor(Date.now() / 1000) + EIGHT_WEEKS_SECONDS;

        const rawType = activity.type || 'Unknown';
        const normalizedType = normalizeActivityType(rawType);
        // Snowboard elevation is excluded (descent-only — misleading for load tracking)
        const elevation = rawType === 'Snowboard' ? 0 : (activity.total_elevation_gain || 0);

        const activityIdStr = String(activity.id);
        const wantsPace = normalizedType === 'Run';
        const wantsPower = normalizedType === 'Cycling';
        const wantsGrade = normalizedType === 'Run';

        let activityHrZones;
        let activityPaceZones = null;
        let activityPowerZones = null;
        let activityGradeZones = null;

        if (isFullyProcessed(existingZoneData[activityIdStr], rawType, effectivePaceThresholds)) {
          // Reuse all stored zone data
          const stored = existingZoneData[activityIdStr];
          activityHrZones = stored.hrZones;
          activityPaceZones = stored.paceZones || null;
          activityPowerZones = stored.powerZones || null;
          activityGradeZones = stored.gradeZones || null;
        } else {
          // Fetch streams and compute zone distributions
          try {
            const streams = await fetchActivityStreams(accessToken, activity.id);
            if (streams) {
              activityHrZones = hrZones
                ? computeZoneTimes(streams.time, streams.heartrate, hrZones, {
                    hrBias: normalizedType === 'Cycling' ? 13 : 0,
                    minHr: 80,
                  })
                : [0, 0, 0, 0, 0];
              activityPaceZones = wantsPace
                ? (streams.velocity ? computePaceZones(streams.time, streams.velocity, paceThresholds) : [0, 0, 0, 0, 0, 0, 0])
                : null;
              activityPowerZones = wantsPower
                ? (streams.watts && ftp ? computePowerZones(streams.time, streams.watts, ftp) : [0, 0, 0, 0, 0, 0, 0])
                : null;
              activityGradeZones = wantsGrade
                ? (streams.grade ? computeGradeZones(streams.time, streams.grade) : [0, 0, 0, 0])
                : null;
            } else {
              activityHrZones = [0, 0, 0, 0, 0];
              activityPaceZones = wantsPace ? [0, 0, 0, 0, 0, 0, 0] : null;
              activityPowerZones = wantsPower ? [0, 0, 0, 0, 0, 0, 0] : null;
              activityGradeZones = wantsGrade ? [0, 0, 0, 0] : null;
            }
          } catch (e) {
            console.warn(`Stream fetch failed for activity ${activity.id}:`, e.message);
            activityHrZones = [0, 0, 0, 0, 0];
            activityPaceZones = wantsPace ? [0, 0, 0, 0, 0, 0, 0] : null;
            activityPowerZones = wantsPower ? [0, 0, 0, 0, 0, 0, 0] : null;
            activityGradeZones = wantsGrade ? [0, 0, 0, 0] : null;
          }
        }

        const item = {
          userId,
          activityId: activityIdStr,
          date: dateStr,
          distance: activity.distance || 0,  // meters
          elevation,                         // meters (0 for Snowboard)
          time: activity.moving_time || 0,   // seconds
          activityType: normalizedType,
          weekStart,
          hrZones: activityHrZones,          // [z1s, z2s, z3s, z4s, z5s] in seconds
          ttl,
        };
        if (activityPaceZones !== null) {
          item.paceZones = activityPaceZones;           // runs only
          item.paceZoneThresholds = effectivePaceThresholds; // record which thresholds were used
        }
        if (activityPowerZones !== null) item.powerZones = activityPowerZones; // cycling only
        if (activityGradeZones !== null) item.gradeZones = activityGradeZones; // runs only

        await dynamo.send(new PutCommand({
          TableName: process.env.ACTIVITIES_TABLE,
          Item: item,
        }));
        syncCount++;
      }

      await dynamo.send(new UpdateCommand({
        TableName: process.env.USERS_TABLE,
        Key: { userId },
        UpdateExpression: 'SET lastSynced = :ts',
        ExpressionAttributeValues: { ':ts': new Date().toISOString() },
      }));

      return response(200, { synced: syncCount, deleted: toDelete.length });
    })(event);
  }

  // GET /activities — return weekly aggregates for last 8 weeks
  if (method === 'GET') {
    return withAuth(async (event, userId) => {
      const eightWeeksAgoMonday = getWeekStartNWeeksAgo(8);

      const result = await dynamo.send(new QueryCommand({
        TableName: process.env.ACTIVITIES_TABLE,
        IndexName: 'userId-weekStart-index',
        KeyConditionExpression: 'userId = :uid AND weekStart >= :minWeek',
        ExpressionAttributeValues: {
          ':uid': userId,
          ':minWeek': eightWeeksAgoMonday,
        },
      }));

      const activities = result.Items || [];

      // Group by weekStart, summing totals, byType breakdown, and all zone totals
      const weekMap = {};
      for (const act of activities) {
        if (!weekMap[act.weekStart]) {
          weekMap[act.weekStart] = {
            weekStart: act.weekStart,
            totalDistance: 0,
            totalElevation: 0,
            totalTime: 0,
            byType: {},
            hrZones: [0, 0, 0, 0, 0],
            paceZones: [0, 0, 0, 0, 0, 0, 0],
            powerZones: [0, 0, 0, 0, 0, 0, 0],
            gradeZones: [0, 0, 0, 0],
          };
        }
        const w = weekMap[act.weekStart];
        const type = act.activityType || 'Unknown';
        w.totalDistance  += act.distance  || 0;
        w.totalElevation += act.elevation || 0;
        w.totalTime      += act.time      || 0;
        if (!w.byType[type]) w.byType[type] = { distance: 0, elevation: 0, time: 0 };
        w.byType[type].distance  += act.distance  || 0;
        w.byType[type].elevation += act.elevation || 0;
        w.byType[type].time      += act.time      || 0;
        if (Array.isArray(act.hrZones)) {
          for (let z = 0; z < 5; z++) w.hrZones[z] += act.hrZones[z] || 0;
        }
        if (Array.isArray(act.paceZones)) {
          for (let z = 0; z < 7; z++) w.paceZones[z] += act.paceZones[z] || 0;
        }
        if (Array.isArray(act.powerZones)) {
          for (let z = 0; z < 7; z++) w.powerZones[z] += act.powerZones[z] || 0;
        }
        if (Array.isArray(act.gradeZones)) {
          for (let z = 0; z < 4; z++) w.gradeZones[z] += act.gradeZones[z] || 0;
        }
      }

      // Fill in any missing weeks with zeros and sort oldest→newest
      const weeks = [];
      for (let i = 7; i >= 0; i--) {
        const weekStart = getWeekStartNWeeksAgo(i);
        weeks.push(weekMap[weekStart] || {
          weekStart,
          totalDistance: 0,
          totalElevation: 0,
          totalTime: 0,
          byType: {},
          hrZones: [0, 0, 0, 0, 0],
          paceZones: [0, 0, 0, 0, 0, 0, 0],
          powerZones: [0, 0, 0, 0, 0, 0, 0],
          gradeZones: [0, 0, 0, 0, 0, 0],
        });
      }

      return response(200, { weeks });
    })(event);
  }

  return response(405, { error: 'Method not allowed' });
};
