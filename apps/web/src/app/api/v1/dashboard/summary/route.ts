import { NextResponse } from 'next/server';
import { connectToDatabase, withDbRetry } from '@/lib/db';
import { CallModel, UserModel, TeamModel, DeviceModel } from '@/lib/models';
import { cacheGet, cacheSet } from '@/lib/cache';
import { DASHBOARD_SUMMARY_CACHE_KEY, DASHBOARD_SUMMARY_CACHE_TTL } from '@/lib/cache-service';
import { INTERNATIONAL_SIM_PHONE_PATTERN, WHATSAPP_DISPOSITION_PATTERN, WHATSAPP_CALL_KEY_PATTERN } from '@recordhub/shared';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const dateRange = searchParams.get('dateRange') || searchParams.get('range') || 'All time';
    const startDateParam = searchParams.get('startDate') || searchParams.get('from');
    const endDateParam = searchParams.get('endDate') || searchParams.get('to');
    const counselorEmail = searchParams.get('counselorEmail') || searchParams.get('email');
    const agentName = searchParams.get('agentName');
    const team = searchParams.get('team');
    const channel = searchParams.get('channel');

    const cacheKey = `summary:v2:${dateRange}:${startDateParam || ''}:${endDateParam || ''}:${counselorEmail || ''}:${agentName || ''}:${team || ''}:${channel || ''}`;
    const cached = await cacheGet<any>(cacheKey);
    if (cached) {
      const res = NextResponse.json(cached);
      res.headers.set('Access-Control-Allow-Origin', '*');
      res.headers.set('X-Cache', 'HIT');
      return res;
    }

    const match: any = {};
    const andConditions: any[] = [];

    // Filter out non-call text/chat message noise
    andConditions.push({ phoneNumber: { $not: /message|messages|unread|mention|group:/i } });

    // 1. Date Range Matching
    if (dateRange !== 'All time') {
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

      if (dateRange === 'Today') {
        const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        andConditions.push({ startTime: { $gte: startOfToday, $lte: endOfToday } });
      } else if (dateRange === 'Last 24 hours') {
        const last24h = new Date(now.getTime() - 24 * 3600 * 1000);
        andConditions.push({ startTime: { $gte: last24h, $lte: now } });
      } else if (dateRange === 'Yesterday') {
        const startOfYesterday = new Date(startOfToday.getTime() - 86400000);
        const endOfYesterday = new Date(startOfToday.getTime() - 1);
        andConditions.push({ startTime: { $gte: startOfYesterday, $lte: endOfYesterday } });
      } else if (dateRange === 'This week') {
        const sevenDaysAgo = new Date(startOfToday.getTime() - 7 * 86400000);
        andConditions.push({ startTime: { $gte: sevenDaysAgo } });
      } else if (dateRange === 'This month') {
        const thirtyDaysAgo = new Date(startOfToday.getTime() - 30 * 86400000);
        andConditions.push({ startTime: { $gte: thirtyDaysAgo } });
      } else if (dateRange === 'Custom') {
        if (startDateParam || endDateParam) {
          const customDateMatch: any = {};
          if (startDateParam) {
            const [sYear, sMonth, sDay] = startDateParam.split('-').map(Number);
            customDateMatch.$gte = new Date(sYear, sMonth - 1, sDay, 0, 0, 0, 0);
          }
          if (endDateParam) {
            const [eYear, eMonth, eDay] = endDateParam.split('-').map(Number);
            customDateMatch.$lte = new Date(eYear, eMonth - 1, eDay, 23, 59, 59, 999);
          }
          andConditions.push({ startTime: customDateMatch });
        }
      }
    }

    // Counselor / Agent filter
    if (counselorEmail || (agentName && agentName !== 'All Counselors')) {
      const cleanEmail = (counselorEmail || '').toLowerCase().trim();
      const cleanAgent = (agentName && agentName !== 'All Counselors') ? agentName.trim() : '';

      const escapedAgentPattern = cleanAgent
        ? cleanAgent.split(/\s+/).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')
        : '';

      const userQueryClauses: any[] = [];
      if (cleanEmail) {
        const escEmail = cleanEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        userQueryClauses.push({ email: { $regex: `^${escEmail}$`, $options: 'i' } });
      } else if (cleanAgent) {
        userQueryClauses.push(
          { email: { $regex: `^${cleanAgent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } },
          {
            $expr: {
              $regexMatch: {
                input: { $concat: [{ $ifNull: ['$firstName', ''] }, ' ', { $ifNull: ['$lastName', ''] }] },
                regex: `^\\s*${escapedAgentPattern}\\s*$`,
                options: 'i',
              },
            },
          },
          {
            firstName: { $regex: `^\\s*${escapedAgentPattern}\\s*$`, $options: 'i' },
            $or: [{ lastName: { $exists: false } }, { lastName: '' }, { lastName: null }],
          }
        );
      }

      const userDocs = userQueryClauses.length > 0
        ? await (UserModel as any).find({ $or: userQueryClauses }).select('email _id firstName lastName').lean().exec()
        : [];

      const matchedEmails = new Set<string>();
      if (cleanEmail) matchedEmails.add(cleanEmail);
      userDocs.forEach((u: any) => {
        if (u.email) matchedEmails.add(u.email.toLowerCase().trim());
      });

      const matchedUserIds = userDocs.map((u: any) => u._id ? u._id.toString() : '').filter(Boolean);

      const deviceQueryClauses: any[] = [];
      if (matchedUserIds.length > 0) {
        deviceQueryClauses.push({ userId: { $in: matchedUserIds } });
      }
      if (matchedEmails.size > 0) {
        deviceQueryClauses.push({ counselorEmail: { $in: Array.from(matchedEmails) } });
      }
      if (deviceQueryClauses.length === 0 && escapedAgentPattern) {
        deviceQueryClauses.push({ agentName: { $regex: `^\\s*${escapedAgentPattern}\\s*$`, $options: 'i' } });
      }

      const deviceDocs = deviceQueryClauses.length > 0
        ? await (DeviceModel as any).find({ $or: deviceQueryClauses }).select('deviceId').lean().exec()
        : [];

      const matchedDeviceIds = deviceDocs.map((d: any) => d.deviceId).filter(Boolean);

      const orClauses: any[] = [];
      if (matchedEmails.size > 0) {
        Array.from(matchedEmails).forEach((em: string) => {
          const esc = em.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          orClauses.push({ counselorEmail: { $regex: `^${esc}$`, $options: 'i' } });
        });
      }

      if (escapedAgentPattern) {
        orClauses.push(
          { agentName: { $regex: `^\\s*${escapedAgentPattern}\\s*$`, $options: 'i' } },
          { counselorName: { $regex: `^\\s*${escapedAgentPattern}\\s*$`, $options: 'i' } }
        );
      }

      if (matchedDeviceIds.length > 0) {
        orClauses.push({ deviceId: { $in: matchedDeviceIds } });
      }

      if (orClauses.length > 0) {
        andConditions.push({ $or: orClauses });
      }
    }
    if (team && team !== 'All Teams') {
      const cleanTeam = team.trim();
      const teamDoc = await (TeamModel as any).findOne({ name: { $regex: `^${cleanTeam}$`, $options: 'i' } }).lean().exec();
      const teamMembers: string[] = [];
      if (teamDoc) {
        if (Array.isArray(teamDoc.members)) {
          teamDoc.members.forEach((m: string) => {
            if (m && m.trim()) teamMembers.push(m.trim());
          });
        }
        if (teamDoc.admin) teamMembers.push(teamDoc.admin.trim());
        if (teamDoc.teamLeadEmail) teamMembers.push(teamDoc.teamLeadEmail.trim());
      }
      const usersInTeam = await (UserModel as any).find({ team: { $regex: `^${cleanTeam}$`, $options: 'i' } }).lean().exec();
      usersInTeam.forEach((u: any) => {
        if (u.email) teamMembers.push(u.email);
        if (u.firstName) teamMembers.push(u.firstName);
        if (u.firstName && u.lastName) teamMembers.push(`${u.firstName} ${u.lastName}`.trim());
      });

      const memberRegexes = Array.from(new Set(teamMembers)).filter(Boolean).map((m) => ({
        $regex: m,
        $options: 'i',
      }));

      const teamOrClauses: any[] = [
        { team: { $regex: `^${cleanTeam}$`, $options: 'i' } },
        { teamName: { $regex: `^${cleanTeam}$`, $options: 'i' } },
        { department: { $regex: `^${cleanTeam}$`, $options: 'i' } },
      ];

      memberRegexes.forEach((r) => {
        teamOrClauses.push({ agentName: r });
        teamOrClauses.push({ counselorEmail: r });
        teamOrClauses.push({ counselorName: r });
        teamOrClauses.push({ userName: r });
      });

      andConditions.push({ $or: teamOrClauses });
    }
    if (channel) {
      andConditions.push({ channel: channel.toUpperCase().trim() });
    }

    if (andConditions.length > 0) {
      match.$and = andConditions;
    }

    const summaryResult = await withDbRetry(async () => {
      const [stats] = await (CallModel as any).aggregate([
        { $match: match },
        {
          $set: {
            _internationalSimCall: {
              $and: [
                { $in: [{ $toUpper: { $trim: { input: { $ifNull: ['$channel', 'CELLULAR'] } } } }, ['CELLULAR', 'SIM']] },
                { $in: [{ $toUpper: { $trim: { input: { $ifNull: ['$direction', ''] } } } }, ['OUTGOING', 'OUTBOUND']] },
                { $not: [{ $regexMatch: { input: { $ifNull: ['$disposition', ''] }, regex: WHATSAPP_DISPOSITION_PATTERN } }] },
                { $not: [{ $regexMatch: { input: { $ifNull: ['$idempotencyKey', ''] }, regex: WHATSAPP_CALL_KEY_PATTERN } }] },
                {
                  $regexMatch: {
                    // Keep non-separator characters so names and masked numbers cannot become valid digits.
                    input: {
                      $reduce: {
                        input: {
                          $regexFindAll: {
                            input: {
                              $convert: {
                                input: { $cond: [{ $in: ['$phoneNumber', [null, '']] }, '$phoneNumberMasked', { $ifNull: ['$phoneNumber', '$phoneNumberMasked'] }] },
                                to: 'string', onError: '', onNull: '',
                              },
                            },
                            regex: /[^\s().-]/,
                          },
                        },
                        initialValue: '',
                        in: { $concat: ['$$value', '$$this.match'] },
                      },
                    },
                    regex: INTERNATIONAL_SIM_PHONE_PATTERN,
                  },
                },
              ],
            },
          },
        },
        {
          $facet: {
            kpis: [
              {
                $group: {
                  _id: null,
                  totalCalls: { $sum: 1 },
                  internationalSimCalls: { $sum: { $cond: ['$_internationalSimCall', 1, 0] } },
                  outboundCalls: { $sum: { $cond: [{ $in: [{ $toUpper: '$direction' }, ['OUTGOING', 'OUTBOUND']] }, 1, 0] } },
                  inboundCalls: { $sum: { $cond: [{ $in: [{ $toUpper: '$direction' }, ['INCOMING', 'INBOUND']] }, 1, 0] } },
                  answeredCalls: { $sum: { $cond: [{ $eq: [{ $toUpper: '$status' }, 'ANSWERED'] }, 1, 0] } },
                  unansweredCalls: { $sum: { $cond: [{ $ne: [{ $toUpper: '$status' }, 'ANSWERED'] }, 1, 0] } },
                  totalDuration: { $sum: { $cond: [{ $eq: [{ $toUpper: '$status' }, 'ANSWERED'] }, { $ifNull: ['$durationSeconds', 0] }, 0] } },
                  outboundDuration: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $in: [{ $toUpper: '$direction' }, ['OUTGOING', 'OUTBOUND']] },
                            { $eq: [{ $toUpper: '$status' }, 'ANSWERED'] },
                          ],
                        },
                        { $ifNull: ['$durationSeconds', 0] },
                        0,
                      ],
                    },
                  },
                  inboundDuration: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $in: [{ $toUpper: '$direction' }, ['INCOMING', 'INBOUND']] },
                            { $eq: [{ $toUpper: '$status' }, 'ANSWERED'] },
                          ],
                        },
                        { $ifNull: ['$durationSeconds', 0] },
                        0,
                      ],
                    },
                  },
                },
              },
            ],
            byCounselor: [
              {
                $group: {
                  _id: { $ifNull: ['$counselorEmail', '$agentName'] },
                  agentName: { $first: '$agentName' },
                  counselorEmail: { $first: '$counselorEmail' },
                  team: { $first: '$team' },
                  totalCalls: { $sum: 1 },
                  internationalSimCalls: { $sum: { $cond: ['$_internationalSimCall', 1, 0] } },
                  answeredCalls: { $sum: { $cond: [{ $eq: [{ $toUpper: '$status' }, 'ANSWERED'] }, 1, 0] } },
                  unansweredCalls: { $sum: { $cond: [{ $ne: [{ $toUpper: '$status' }, 'ANSWERED'] }, 1, 0] } },
                  whatsappCalls: {
                    $sum: {
                      $cond: [
                        {
                          $or: [
                            { $eq: [{ $toUpper: '$channel' }, 'WHATSAPP'] },
                            { $regexMatch: { input: { $ifNull: ['$disposition', ''] }, regex: /whatsapp/i } },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  durationSeconds: { $sum: { $cond: [{ $eq: [{ $toUpper: '$status' }, 'ANSWERED'] }, { $ifNull: ['$durationSeconds', 0] }, 0] } },
                },
              },
              { $sort: { totalCalls: -1 } },
            ],
            byHour: [
              {
                $project: {
                  hour: { $hour: { date: '$startTime', timezone: '+05:30' } },
                },
              },
              {
                $group: {
                  _id: '$hour',
                  count: { $sum: 1 },
                },
              },
              { $sort: { _id: 1 } },
            ],
          },
        },
      ]);

      const kpi = stats?.kpis?.[0] || {
        totalCalls: 0,
        internationalSimCalls: 0,
        outboundCalls: 0,
        inboundCalls: 0,
        answeredCalls: 0,
        unansweredCalls: 0,
        totalDuration: 0,
        outboundDuration: 0,
        inboundDuration: 0,
      };

      const hours = Array.from({ length: 24 }, (_, i) => {
        const found = (stats?.byHour || []).find((h: any) => h._id === i);
        return {
          hourIndex: i,
          count: found ? found.count : 0,
        };
      });

      return {
        ...kpi,
        hourlyDistribution: hours,
        byCounselor: stats?.byCounselor || [],
      };
    });

    await cacheSet(cacheKey, summaryResult, DASHBOARD_SUMMARY_CACHE_TTL);

    const res = NextResponse.json(summaryResult);
    res.headers.set('Access-Control-Allow-Origin', '*');
    res.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.headers.set('X-Cache', 'MISS');
    return res;
  } catch (err: any) {
    console.error('Error in GET /api/v1/dashboard/summary:', err);
    return NextResponse.json({ message: err.message || 'Error generating summary' }, { status: 500 });
  }
}
