import { NextResponse } from 'next/server';
import {
  getCallsWithCache,
  rebuildCallsCache,
  formatPhoneNumber,
  patchCallInCache,
  updateCallsCacheWithNewBatch,
  revalidateCallsCacheInBackground,
  queryCallsFromDb,
  CALLS_CACHE_KEY,
} from '@/lib/cache-service';
import { cacheDel } from '@/lib/cache';
import { connectToDatabase, withDbRetry } from '@/lib/db';
import { CallModel, DeviceModel, TeamModel, UserModel } from '@/lib/models';
import { getS3Client } from '@/lib/aws';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import mongoose from 'mongoose';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limitParam = searchParams.get('limit') || searchParams.get('pageSize');
    const isExport = searchParams.get('export') === 'true';
    const isAll = searchParams.get('all') === 'true';
    const pageSize = isExport || isAll ? 25000 : Math.min(Math.max(1, parseInt(limitParam || '10', 10)), 500);
    const skip = (page - 1) * pageSize;

    const dateRange = searchParams.get('dateRange') || searchParams.get('range') || 'All time';
    const startDateParam = searchParams.get('startDate') || searchParams.get('from');
    const endDateParam = searchParams.get('endDate') || searchParams.get('to');
    const counselorEmail = searchParams.get('counselorEmail') || searchParams.get('email');
    const agentName = searchParams.get('agentName');
    const team = searchParams.get('team');
    const search = searchParams.get('search') || searchParams.get('q');
    const channel = searchParams.get('channel');
    const anomaly = searchParams.get('anomaly') || searchParams.get('filter');
    const sortField = searchParams.get('sortField') || searchParams.get('sortBy') || 'startTime';
    const sortOrder = (searchParams.get('sortOrder') || searchParams.get('order') || 'desc').toLowerCase();

    // 1. Build MongoDB Match Filter (using andConditions to prevent filter overwrites)
    const match: any = {};
    const andConditions: any[] = [];

    // Filter out non-call text/chat message noise
    andConditions.push({ phoneNumber: { $not: /message|messages|unread|mention|group:/i } });

    // Date Range Matching
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

    // Team filter (resolves team members dynamically from Team and User models)
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

    // Tab / Anomaly Filter
    if (anomaly === 'whatsapp') {
      andConditions.push({
        $or: [
          { channel: 'WHATSAPP' },
          { channel: 'WHATSAPP_WEB' },
          { disposition: { $regex: /whatsapp/i } },
          { disposition: { $regex: /web/i } },
          { idempotencyKey: { $regex: /^WA_/i } },
        ],
      });
    } else if (anomaly === 'sim') {
      andConditions.push({
        channel: { $nin: ['WHATSAPP', 'WHATSAPP_WEB'] },
        disposition: { $not: /(whatsapp|web)/i },
        idempotencyKey: { $not: /^WA_/i },
      });
    } else if (anomaly === 'unanswered') {
      andConditions.push({ status: { $ne: 'ANSWERED' } });
    } else if (anomaly === 'bookmarked') {
      andConditions.push({
        $or: [
          { isBookmarked: true },
          { rating: { $gt: 0 } },
        ],
      });
    } else if (anomaly === 'recordings') {
      andConditions.push({
        $or: [
          { recordingStatus: { $in: ['COMPLETED', 'PENDING_UPLOAD'] } },
          { s3Key: { $exists: true, $ne: '' } },
          { audioUrl: { $exists: true, $ne: '' } },
        ],
      });
    }

    // Search Query (Phone, Contact Name, Counselor Name)
    if (search && search.trim()) {
      const term = search.trim();
      const searchRegex = { $regex: term, $options: 'i' };
      andConditions.push({
        $or: [
          { phoneNumber: searchRegex },
          { phoneNumberMasked: searchRegex },
          { leadName: searchRegex },
          { agentName: searchRegex },
        ],
      });
    }

    if (andConditions.length > 0) {
      match.$and = andConditions;
    }

    // 2. Sorting Stage
    const sortStage: any = {};
    const sortDirection = sortOrder === 'asc' ? 1 : -1;

    switch (sortField) {
      case 'duration':
        sortStage.durationSeconds = sortDirection;
        break;
      case 'user':
        sortStage.agentName = sortDirection;
        break;
      case 'phone':
        sortStage.phoneNumber = sortDirection;
        break;
      case 'name':
        sortStage.leadName = sortDirection;
        break;
      case 'direction':
        sortStage.direction = sortDirection;
        break;
      case 'status':
        sortStage.status = sortDirection;
        break;
      case 'type':
        sortStage.channel = sortDirection;
        break;
      case 'startTime':
      default:
        sortStage.startTime = sortDirection;
        sortStage.createdAt = sortDirection;
        break;
    }

    // 3. Execute High-Speed MongoDB Facet Aggregation Pipeline
    const facetResult = await withDbRetry(async () => {
      const [res] = await (CallModel as any).aggregate([
        { $match: match },
        {
          $facet: {
            stats: [
              {
                $group: {
                  _id: null,
                  totalCount: { $sum: 1 },
                  totalDuration: {
                    $sum: {
                      $cond: [
                        { $eq: [{ $toUpper: '$status' }, 'ANSWERED'] },
                        { $ifNull: ['$durationSeconds', 0] },
                        0,
                      ],
                    },
                  },
                  outboundCount: {
                    $sum: {
                      $cond: [
                        { $in: [{ $toUpper: '$direction' }, ['OUTGOING', 'OUTBOUND']] },
                        1,
                        0,
                      ],
                    },
                  },
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
                  inboundCount: {
                    $sum: {
                      $cond: [
                        { $in: [{ $toUpper: '$direction' }, ['INCOMING', 'INBOUND']] },
                        1,
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
                  answeredCount: {
                    $sum: {
                      $cond: [{ $eq: [{ $toUpper: '$status' }, 'ANSWERED'] }, 1, 0],
                    },
                  },
                  unansweredCount: {
                    $sum: {
                      $cond: [{ $ne: [{ $toUpper: '$status' }, 'ANSWERED'] }, 1, 0],
                    },
                  },
                  waCount: {
                    $sum: {
                      $cond: [
                        {
                          $or: [
                            { $eq: [{ $toUpper: '$channel' }, 'WHATSAPP'] },
                            { $eq: [{ $toUpper: '$channel' }, 'WHATSAPP_WEB'] },
                            { $regexMatch: { input: { $ifNull: ['$disposition', ''] }, regex: /whatsapp/i } },
                            { $regexMatch: { input: { $ifNull: ['$disposition', ''] }, regex: /web/i } },
                            { $regexMatch: { input: { $ifNull: ['$idempotencyKey', ''] }, regex: /^WA_/i } },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  simCount: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $ne: [{ $toUpper: '$channel' }, 'WHATSAPP'] },
                            { $ne: [{ $toUpper: '$channel' }, 'WHATSAPP_WEB'] },
                            { $not: { $regexMatch: { input: { $ifNull: ['$disposition', ''] }, regex: /whatsapp/i } } },
                            { $not: { $regexMatch: { input: { $ifNull: ['$disposition', ''] }, regex: /web/i } } },
                            { $not: { $regexMatch: { input: { $ifNull: ['$idempotencyKey', ''] }, regex: /^WA_/i } } },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                },
              },
            ],
            calls: [
              { $sort: sortStage },
              { $skip: skip },
              { $limit: pageSize },
              {
                $project: {
                  idempotencyKey: 1,
                  phoneNumber: 1,
                  phoneNumberMasked: 1,
                  direction: 1,
                  status: 1,
                  startTime: 1,
                  endTime: 1,
                  durationSeconds: 1,
                  simSlot: 1,
                  isPrivate: 1,
                  disposition: 1,
                  channel: 1,
                  agentName: 1,
                  counselorEmail: 1,
                  leadName: 1,
                  recordingStatus: 1,
                  s3Key: 1,
                  audioUrl: 1,
                  notes: 1,
                  rating: 1,
                  isBookmarked: 1,
                  team: 1,
                  deviceId: 1,
                  createdAt: 1,
                  updatedAt: 1,
                },
              },
            ],
          },
        },
      ]);
      return res;
    });

    const rawStats = facetResult?.stats?.[0] || {
      totalCount: 0,
      totalDuration: 0,
      outboundCount: 0,
      outboundDuration: 0,
      inboundCount: 0,
      inboundDuration: 0,
      answeredCount: 0,
      unansweredCount: 0,
      waCount: 0,
      simCount: 0,
    };

    const totalRecords = rawStats.totalCount || 0;
    const totalPages = Math.ceil(totalRecords / pageSize) || 1;

    const formatDuration = (totalSec: number) => {
      const hours = Math.floor(totalSec / 3600);
      const mins = Math.floor((totalSec % 3600) / 60);
      const secs = totalSec % 60;
      if (hours > 0) return `${hours}h ${mins}m`;
      if (mins > 0) return `${mins}m ${secs}s`;
      return `${secs}s`;
    };

    const formattedCalls = (facetResult?.calls || []).map((c: any) => {
      const formattedPhone = formatPhoneNumber(c.phoneNumber || c.phoneNumberMasked || '');
      if (formattedPhone) {
        c.phoneNumber = formattedPhone;
        c.phoneNumberMasked = formattedPhone;
      }
      const isAns = (c.status || 'ANSWERED').toUpperCase() === 'ANSWERED';
      if (!isAns) {
        c.durationSeconds = 0;
      }
      return c;
    });

    const stats = {
      totalCount: totalRecords,
      totalDurSec: rawStats.totalDuration,
      totalTalkTimeStr: formatDuration(rawStats.totalDuration),
      outboundCount: rawStats.outboundCount,
      outboundDurSec: rawStats.outboundDuration,
      outboundTalkTimeStr: formatDuration(rawStats.outboundDuration),
      inboundCount: rawStats.inboundCount,
      inboundDurSec: rawStats.inboundDuration,
      inboundTalkTimeStr: formatDuration(rawStats.inboundDuration),
      answeredCount: rawStats.answeredCount,
      unansweredCount: rawStats.unansweredCount,
      simCount: rawStats.simCount,
      waCount: rawStats.waCount,
      mismatchCount: 0,
    };

    const responsePayload = {
      calls: formattedCalls,
      totalRecords,
      totalPages,
      page,
      pageSize,
      totalCount: totalRecords,
      stats,
    };

    const res = NextResponse.json(responsePayload);
    res.headers.set('Access-Control-Allow-Origin', '*');
    res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.headers.set('X-Total-Count', String(totalRecords));
    return res;
  } catch (err: any) {
    console.error('Error in GET /api/v1/calls:', err);
    const errRes = NextResponse.json({ calls: [], totalRecords: 0, totalPages: 1, page: 1, pageSize: 10, totalCount: 0, stats: null }, { status: 200 });
    errRes.headers.set('Access-Control-Allow-Origin', '*');
    return errRes;
  }
}

/**
 * POST /api/v1/calls - Manually add a call log (Super Admin)
 */
export async function POST(req: Request) {
  try {
    await connectToDatabase();
    const body = await req.json().catch(() => ({}));

    const rawPhone = (body.phoneNumber || body.phone || body.phoneNumberMasked || '').trim();
    const channel = (body.channel || 'CELLULAR').toUpperCase();
    const formattedPhone = channel === 'WHATSAPP' ? rawPhone : (formatPhoneNumber(rawPhone) || rawPhone || '+91 99361 67436');
    const agentName = (body.agentName || body.counselorName || 'Counselor Agent').trim();
    const leadName = (body.leadName || body.name || formattedPhone).trim();
    const direction = (body.direction || 'OUTGOING').toUpperCase();
    const status = (body.status || 'ANSWERED').toUpperCase();
    const durationSeconds = status === 'ANSWERED' ? Math.max(0, Number(body.durationSeconds || 0)) : 0;
    const startTime = body.startTime ? new Date(body.startTime) : new Date();
    const endTime = new Date(startTime.getTime() + durationSeconds * 1000);
    const disposition = body.disposition || body.notes || 'Manual Call Record';
    const idempotencyKey = `MANUAL_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const newCallData = {
      organizationId: '65c1f0000000000000000001',
      idempotencyKey,
      phoneNumber: formattedPhone,
      phoneNumberMasked: formattedPhone,
      phoneNumberHash: '',
      agentName,
      leadName,
      channel,
      direction,
      status,
      durationSeconds,
      startTime,
      endTime,
      disposition,
      notes: body.notes || '',
      team: body.team || body.teamName || '',
      recordingStatus: 'NONE',
      deviceId: 'MANUAL-SUPERADMIN-ENTRY',
      isPrivate: false,
    };

    const createdCall = await (CallModel as any).create(newCallData);

    // Update in-memory cache incrementally
    await updateCallsCacheWithNewBatch([createdCall.toObject ? createdCall.toObject() : createdCall]);

    const res = NextResponse.json({
      success: true,
      call: createdCall,
    });
    res.headers.set('Access-Control-Allow-Origin', '*');
    return res;
  } catch (err: any) {
    console.error('Error creating manual call log:', err);
    return NextResponse.json({ message: err.message || 'Error creating call log' }, { status: 500 });
  }
}

/**
 * PUT /api/v1/calls - Edit any call log & edit any phone number (Super Admin)
 */
export async function PUT(req: Request) {
  try {
    await connectToDatabase();
    const { searchParams } = new URL(req.url);
    const paramId = searchParams.get('id');
    const body = await req.json().catch(() => ({}));
    const targetId = paramId || body.id || body._id || body.idempotencyKey;

    if (!targetId) {
      return NextResponse.json({ message: 'Call ID or idempotencyKey required for update' }, { status: 400 });
    }

    const updateFields: any = {};
    if (body.phoneNumber !== undefined || body.phone !== undefined) {
      const raw = (body.phoneNumber || body.phone || '').trim();
      const formatted = formatPhoneNumber(raw) || raw;
      updateFields.phoneNumber = formatted;
      updateFields.phoneNumberMasked = formatted;
    }
    if (body.leadName !== undefined || body.name !== undefined) {
      updateFields.leadName = (body.leadName || body.name || '').trim();
    }
    if (body.agentName !== undefined || body.counselorName !== undefined) {
      updateFields.agentName = (body.agentName || body.counselorName || '').trim();
    }
    if (body.channel !== undefined) {
      updateFields.channel = (body.channel || 'CELLULAR').toUpperCase();
    }
    if (body.direction !== undefined) {
      updateFields.direction = (body.direction || 'OUTGOING').toUpperCase();
    }
    if (body.status !== undefined) {
      updateFields.status = (body.status || 'ANSWERED').toUpperCase();
      if (updateFields.status !== 'ANSWERED') {
        updateFields.durationSeconds = 0;
      }
    }
    if (body.durationSeconds !== undefined) {
      updateFields.durationSeconds = Math.max(0, Number(body.durationSeconds || 0));
    }
    if (body.startTime !== undefined) {
      updateFields.startTime = new Date(body.startTime);
    }
    if (body.disposition !== undefined) {
      updateFields.disposition = body.disposition;
    }
    if (body.notes !== undefined) {
      updateFields.notes = body.notes;
    }
    if (body.team !== undefined || body.teamName !== undefined) {
      updateFields.team = body.team || body.teamName;
    }

    // Robust filter matching for ObjectId or idempotencyKey string
    const isHex24 = typeof targetId === 'string' && /^[0-9a-fA-F]{24}$/.test(targetId);
    const filter = isHex24
      ? { $or: [{ _id: new mongoose.Types.ObjectId(targetId) }, { idempotencyKey: targetId }] }
      : { idempotencyKey: targetId };

    const updatedCall = await (CallModel as any).findOneAndUpdate(
      filter,
      { $set: updateFields },
      { new: true }
    ).lean().exec();

    if (!updatedCall) {
      return NextResponse.json({ message: 'Call log not found' }, { status: 404 });
    }

    // Patch cache incrementally
    await patchCallInCache(targetId, updateFields).catch(() => { });

    const res = NextResponse.json({
      success: true,
      call: updatedCall,
    });
    res.headers.set('Access-Control-Allow-Origin', '*');
    return res;
  } catch (err: any) {
    console.error('Error updating call log:', err);
    return NextResponse.json({ message: err.message || 'Error updating call log' }, { status: 500 });
  }
}

/**
 * DELETE /api/v1/calls - Delete any call log & associated S3 audio (Super Admin)
 */
export async function DELETE(req: Request) {
  try {
    await connectToDatabase();
    const { searchParams } = new URL(req.url);
    const paramId = searchParams.get('id');
    const body = await req.json().catch(() => ({}));
    const targetId = paramId || body.id || body._id || body.idempotencyKey;

    if (!targetId) {
      return NextResponse.json({ message: 'Call ID or idempotencyKey required for deletion' }, { status: 400 });
    }

    // Robust filter matching for ObjectId or idempotencyKey string
    const isHex24 = typeof targetId === 'string' && /^[0-9a-fA-F]{24}$/.test(targetId);
    const filter = isHex24
      ? { $or: [{ _id: new mongoose.Types.ObjectId(targetId) }, { idempotencyKey: targetId }] }
      : { idempotencyKey: targetId };

    const callToDelete = await (CallModel as any).findOne(filter).lean().exec();

    if (!callToDelete) {
      return NextResponse.json({ message: 'Call log not found' }, { status: 404 });
    }

    // If call has S3 audio file, delete it from AWS S3
    if (callToDelete.s3Key) {
      const s3Info = getS3Client();
      if (s3Info) {
        try {
          const delCmd = new DeleteObjectCommand({
            Bucket: s3Info.bucket,
            Key: callToDelete.s3Key,
          });
          await s3Info.client.send(delCmd);
          console.log(`Deleted S3 recording for call ${targetId}: ${callToDelete.s3Key}`);
        } catch (s3Err) {
          console.warn(`Could not delete S3 audio for call ${targetId}:`, s3Err);
        }
      }
    }

    // Delete from MongoDB
    await (CallModel as any).deleteOne(filter).exec();

    // Invalidate in-memory cache immediately
    await cacheDel(CALLS_CACHE_KEY).catch(() => { });
    revalidateCallsCacheInBackground();

    const res = NextResponse.json({
      success: true,
      deletedId: targetId,
      deletedCall: callToDelete,
    });
    res.headers.set('Access-Control-Allow-Origin', '*');
    return res;
  } catch (err: any) {
    console.error('Error deleting call log:', err);
    return NextResponse.json({ message: err.message || 'Error deleting call log' }, { status: 500 });
  }
}
