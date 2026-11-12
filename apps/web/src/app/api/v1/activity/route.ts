import { NextResponse } from 'next/server';
import { connectToDatabase, withDbRetry } from '@/lib/db';
import { UserSessionModel, AuditLogModel } from '@/lib/models';
import { getClientIp, parseDevice } from '@/lib/activity-logger';
import { buildDateMongoFilter } from '@/lib/date-range';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export async function POST(req: Request) {
  try {
    await connectToDatabase();
    const body = await req.json().catch(() => ({}));
    const userAgent = req.headers.get('user-agent') || '';
    const ipAddress = getClientIp(req);
    const device = parseDevice(userAgent);

    const userEmail = (body.userEmail || '').trim().toLowerCase();
    const action = (body.action || 'PAGE_VIEW').trim();
    const actionCategory = body.actionCategory || 'GENERAL';
    const description = body.description || action;
    const path = body.path || '/dashboard';
    const details = body.details || {};
    const sessionId = (body.sessionId || '').trim();

    if (!userEmail) {
      return NextResponse.json({ success: false, message: 'User email is required' }, { status: 400 });
    }

    const now = new Date();
    const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);

    const activityItem = {
      action,
      actionCategory,
      description,
      path,
      details,
      timestamp: now,
    };

    // 1. Fresh Login: close any prior active sessions and start exactly 1 new session
    if (action === 'LOGIN') {
      await withDbRetry(async () => {
        return await (UserSessionModel as any).updateMany(
          { userEmail, status: 'ACTIVE' },
          { $set: { status: 'LOGGED_OUT' } }
        );
      });

      const newSessionId = sessionId || `sess_${userEmail.replace(/[^a-z0-9]/g, '_')}_${now.getTime()}`;
      const newSessionDoc = {
        organizationId: body.organizationId || '65c1f0000000000000000001',
        sessionId: newSessionId,
        userEmail,
        userName: body.userName || userEmail.split('@')[0],
        userRole: body.userRole || 'COUNSELOR',
        startedAt: now,
        lastActiveAt: now,
        ipAddress,
        userAgent,
        device,
        currentPath: path,
        status: 'ACTIVE',
        activities: [activityItem],
        totalActions: 1,
      };

      const created = await withDbRetry(async () => {
        return await (UserSessionModel as any).create(newSessionDoc);
      });

      return NextResponse.json({ success: true, sessionId: created.sessionId, created: true }, { status: 201 });
    }

    // 2. Ongoing Activity: Find existing active session for this user
    let session = null;
    if (sessionId) {
      session = await (UserSessionModel as any).findOne({ sessionId, status: 'ACTIVE' });
    }

    if (!session) {
      // Find latest active session for this user within the last 12 hours
      session = await (UserSessionModel as any)
        .findOne({
          userEmail,
          status: 'ACTIVE',
          lastActiveAt: { $gte: twelveHoursAgo },
        })
        .sort({ lastActiveAt: -1 });
    }

    if (session) {
      // Check if last activity was identical within 10 seconds (debounce rapid double clicks / re-renders)
      const lastActivity = session.activities?.[0];
      const isDuplicate =
        lastActivity &&
        lastActivity.action === action &&
        lastActivity.path === path &&
        now.getTime() - new Date(lastActivity.timestamp).getTime() < 10000;

      if (!isDuplicate) {
        session.activities.unshift(activityItem);
        // Retain up to 100 activities per session
        if (session.activities.length > 100) {
          session.activities = session.activities.slice(0, 100);
        }
      }

      session.lastActiveAt = now;
      session.currentPath = path;
      session.totalActions = session.activities.length;
      if (device) session.device = device;
      if (ipAddress) session.ipAddress = ipAddress;
      if (body.userName && !session.userName) session.userName = body.userName;
      if (body.userRole) session.userRole = body.userRole;

      if (action === 'LOGOUT') {
        session.status = 'LOGGED_OUT';
      }

      await withDbRetry(async () => {
        return await session.save();
      });

      return NextResponse.json({ success: true, sessionId: session.sessionId, updated: true });
    }

    // 3. No active session found -> Start 1 new active session for this user
    const newSessionId = sessionId || `sess_${userEmail.replace(/[^a-z0-9]/g, '_')}_${now.getTime()}`;
    const newSessionDoc = {
      organizationId: body.organizationId || '65c1f0000000000000000001',
      sessionId: newSessionId,
      userEmail,
      userName: body.userName || userEmail.split('@')[0],
      userRole: body.userRole || 'COUNSELOR',
      startedAt: now,
      lastActiveAt: now,
      ipAddress,
      userAgent,
      device,
      currentPath: path,
      status: action === 'LOGOUT' ? 'LOGGED_OUT' : 'ACTIVE',
      activities: [activityItem],
      totalActions: 1,
    };

    const created = await withDbRetry(async () => {
      return await (UserSessionModel as any).create(newSessionDoc);
    });

    return NextResponse.json({ success: true, sessionId: created.sessionId, created: true }, { status: 201 });
  } catch (err: any) {
    console.error('Error recording activity log session:', err);
    return NextResponse.json({ success: false, message: err.message || 'Internal error' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    await connectToDatabase();
    const { searchParams } = new URL(req.url);

    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25', 10)));
    const skip = (page - 1) * limit;

    const userEmail = searchParams.get('userEmail') || searchParams.get('email');
    const category = searchParams.get('category');
    const action = searchParams.get('action');
    const dateRange = searchParams.get('dateRange') || 'Last 24 hours';
    const startDateParam = searchParams.get('startDate');
    const endDateParam = searchParams.get('endDate');
    const search = (searchParams.get('search') || '').trim();
    const distinctUsers = searchParams.get('distinctUsers') === 'true';

    // Match criteria for UserSession
    const match: any = {};

    if (userEmail && userEmail !== 'all' && userEmail !== 'All Users') {
      match.userEmail = userEmail.toLowerCase().trim();
    }

    if (category && category !== 'all' && category !== 'All Categories') {
      match['activities.actionCategory'] = category;
    }

    if (action && action !== 'all' && action !== 'All Actions') {
      match['activities.action'] = action;
    }

    // Date filtering based on when session was active
    const now = new Date();
    const dateFilter = buildDateMongoFilter(dateRange, startDateParam, endDateParam, now);
    if (dateFilter) {
      match.lastActiveAt = dateFilter;
    }

    // Text search filter
    if (search) {
      const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      match.$or = [
        { userEmail: { $regex: searchRegex } },
        { userName: { $regex: searchRegex } },
        { device: { $regex: searchRegex } },
        { ipAddress: { $regex: searchRegex } },
        { 'activities.description': { $regex: searchRegex } },
        { 'activities.action': { $regex: searchRegex } },
      ];
    }

    // Calculate Summary Stats
    const statsPromise = (async () => {
      const todayFilter = buildDateMongoFilter('Today', null, null, now);
      const todayQuery = todayFilter ? { lastActiveAt: todayFilter } : {};

      const [
        allTodaySessions,
        uniqueUsersToday,
      ] = await Promise.all([
        (UserSessionModel as any).find(todayQuery).lean().exec(),
        (UserSessionModel as any).distinct('userEmail', todayQuery).then((res: any[]) => res?.length || 0),
      ]);

      let totalDashboardOpens = 0;
      let totalRecordingsPlayed = 0;
      let totalActionsToday = 0;
      const categoryCounts: Record<string, number> = {};

      (allTodaySessions || []).forEach((s: any) => {
        (s.activities || []).forEach((act: any) => {
          totalActionsToday++;
          if (act.action === 'OPEN_DASHBOARD') totalDashboardOpens++;
          if (act.action === 'PLAY_RECORDING') totalRecordingsPlayed++;
          const cat = act.actionCategory || 'GENERAL';
          categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
        });
      });

      // Active Users Summary (last 24 hours)
      const twentyFourHoursAgo = new Date(now.getTime() - 24 * 3600 * 1000);
      const recentSessions = await (UserSessionModel as any)
        .find({ lastActiveAt: { $gte: twentyFourHoursAgo } })
        .sort({ lastActiveAt: -1 })
        .lean()
        .exec();

      // Deduplicate to 1 entry per userEmail (latest session)
      const userMap = new Map<string, any>();
      const fifteenMinsAgo = now.getTime() - 15 * 60 * 1000;

      recentSessions.forEach((sess: any) => {
        const em = sess.userEmail.toLowerCase();
        if (!userMap.has(em)) {
          const latestAct = sess.activities?.[0] || {};
          const isOnline =
            sess.status === 'ACTIVE' && new Date(sess.lastActiveAt).getTime() >= fifteenMinsAgo;

          userMap.set(em, {
            sessionId: sess.sessionId,
            userEmail: sess.userEmail,
            userName: sess.userName || sess.userEmail.split('@')[0],
            userRole: sess.userRole || 'COUNSELOR',
            lastActive: sess.lastActiveAt,
            startedAt: sess.startedAt,
            lastAction: latestAct.description || 'Active on dashboard',
            lastActionCode: latestAct.action || 'OPEN_DASHBOARD',
            lastPage: sess.currentPath,
            device: sess.device,
            ipAddress: sess.ipAddress,
            actionsCount: sess.totalActions || (sess.activities?.length || 1),
            isOnline,
          });
        }
      });

      const activeUsers = Array.from(userMap.values()).slice(0, 20);

      const categoryBreakdown = Object.entries(categoryCounts).map(([cat, count]) => ({
        _id: cat,
        count,
      }));

      return {
        totalDashboardOpensToday: totalDashboardOpens,
        uniqueUsersToday,
        totalRecordingsPlayedToday: totalRecordingsPlayed,
        totalActionsToday,
        activeUsers,
        categoryBreakdown,
      };
    })();

    // Query User Sessions with pagination
    const [total, sessions, stats] = await Promise.all([
      (UserSessionModel as any).countDocuments(match),
      (UserSessionModel as any)
        .find(match)
        .sort({ lastActiveAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      statsPromise,
    ]);

    const fifteenMinsAgo = now.getTime() - 15 * 60 * 1000;

    // Format sessions with helper flags
    // Format sessions with helper flags
    let formattedSessions = (sessions || []).map((sess: any) => {
      const isOnline =
        sess.status === 'ACTIVE' && new Date(sess.lastActiveAt).getTime() >= fifteenMinsAgo;
      const latestAct = sess.activities?.[0] || {};
      const diffMs = Math.max(0, new Date(sess.lastActiveAt).getTime() - new Date(sess.startedAt).getTime());
      const durationMinutes = Math.max(1, Math.round(diffMs / 60000));

      return {
        _id: sess._id,
        sessionId: sess.sessionId,
        userEmail: sess.userEmail,
        userName: sess.userName || sess.userEmail.split('@')[0],
        userRole: sess.userRole || 'COUNSELOR',
        startedAt: sess.startedAt,
        lastActiveAt: sess.lastActiveAt,
        durationMinutes,
        ipAddress: sess.ipAddress,
        userAgent: sess.userAgent,
        device: sess.device,
        currentPath: sess.currentPath,
        status: sess.status,
        totalActions: sess.totalActions || sess.activities?.length || 1,
        latestActivity: latestAct,
        activities: sess.activities || [],
        isOnline,
        // Flat field fallbacks for legacy/direct readers
        action: latestAct.action || 'OPEN_DASHBOARD',
        actionCategory: latestAct.actionCategory || 'GENERAL',
        description: latestAct.description || 'Active on dashboard',
        path: latestAct.path || sess.currentPath || '/dashboard',
        timestamp: sess.lastActiveAt || sess.startedAt,
        details: latestAct.details || {},
      };
    });

    if (distinctUsers) {
      const seen = new Set<string>();
      formattedSessions = formattedSessions.filter((s) => {
        const em = (s.userEmail || '').toLowerCase();
        if (seen.has(em)) return false;
        seen.add(em);
        return true;
      });
    }

    const totalPages = Math.ceil(total / limit) || 1;

    return NextResponse.json({
      success: true,
      sessions: formattedSessions,
      // For backwards compatibility with logs view
      logs: formattedSessions,
      total,
      page,
      limit,
      totalPages,
      stats,
    });
  } catch (err: any) {
    console.error('Error querying activity sessions:', err);
    return NextResponse.json({ success: false, message: err.message || 'Error fetching activity sessions' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    await connectToDatabase();
    const [delSessions, delLogs] = await Promise.all([
      (UserSessionModel as any).deleteMany({}),
      (AuditLogModel as any).deleteMany({}),
    ]);
    return NextResponse.json({
      success: true,
      deletedSessionsCount: delSessions.deletedCount,
      deletedLogsCount: delLogs.deletedCount,
    });
  } catch (err: any) {
    console.error('Error clearing activity logs:', err);
    return NextResponse.json({ success: false, message: err.message || 'Error clearing logs' }, { status: 500 });
  }
}
