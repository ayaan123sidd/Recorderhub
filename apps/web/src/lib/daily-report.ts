import * as XLSX from 'xlsx';
import { connectToDatabase, withDbRetry } from '@/lib/db';
import { CallModel, UserModel, TeamModel } from '@/lib/models';

export interface CounselorDailyStat {
  agentName: string;
  counselorEmail: string;
  team: string;
  totalCalls: number;
  answeredCalls: number;
  unansweredCalls: number;
  outboundCalls: number;
  inboundCalls: number;
  whatsappCalls: number;
  totalDurationSeconds: number;
  formattedDuration: string;
  connectRate: string;
  avgDuration: string;
}

export interface DailyReportData {
  reportDateFormatted: string;
  dateKey: string;
  totalCalls: number;
  answeredCalls: number;
  unansweredCalls: number;
  outboundCalls: number;
  inboundCalls: number;
  whatsappCalls: number;
  totalDurationSeconds: number;
  formattedTotalDuration: string;
  connectRate: string;
  activeCounselorCount: number;
  counselors: CounselorDailyStat[];
  topPerformers: CounselorDailyStat[];
}

/**
 * Formats seconds into human-readable hours, minutes, and seconds
 */
export function formatSecondsToTime(totalSeconds: number): string {
  if (!totalSeconds || isNaN(totalSeconds) || totalSeconds <= 0) {
    return '0m 00s';
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds.toString().padStart(2, '0')}s`;
  }
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

/**
 * Calculates start and end of a specific date in Indian Standard Time (IST, UTC+5:30)
 */
export function getISTDateRange(targetDate?: Date | string): { start: Date; end: Date; dateStr: string; formattedDate: string } {
  let base = targetDate ? new Date(targetDate) : new Date();
  if (isNaN(base.getTime())) {
    base = new Date();
  }

  // Convert to IST representation
  const istFormatter = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
  });

  const parts = istFormatter.formatToParts(base);
  const day = parts.find((p) => p.type === 'day')?.value || '01';
  const month = parts.find((p) => p.type === 'month')?.value || '01';
  const year = parts.find((p) => p.type === 'year')?.value || '2026';
  const weekday = parts.find((p) => p.type === 'weekday')?.value || '';

  const dateStr = `${year}-${month}-${day}`;
  const formattedDate = `${weekday}, ${day}/${month}/${year}`;

  // IST 00:00:00 is UTC - 5:30 (e.g. Previous day 18:30:00 UTC)
  const start = new Date(`${dateStr}T00:00:00.000+05:30`);
  const end = new Date(`${dateStr}T23:59:59.999+05:30`);

  return { start, end, dateStr, formattedDate };
}

/**
 * Generates aggregated daily stats from the MongoDB database
 */
export async function generateDailyReportData(targetDate?: Date | string): Promise<{ data: DailyReportData; rawCalls: any[] }> {
  return await withDbRetry(async () => {
    await connectToDatabase();

    const { start, end, dateStr, formattedDate } = getISTDateRange(targetDate);

    // Fetch all calls within the IST date range
    const calls = await (CallModel as any).find({
      startTime: { $gte: start, $lte: end },
      phoneNumber: { $not: /message|messages|unread|mention|group:/i },
    }).lean().exec();

    // 1. Identify all Guest (resigned) user profiles so their data is strictly excluded from daily reports
    const guestUsers = await (UserModel as any)
      .find({
        $or: [
          { role: { $regex: /^guest$/i } },
          { isGuest: true },
        ],
      })
      .select('email firstName lastName _id')
      .lean()
      .exec();

    const guestEmailSet = new Set<string>();
    const guestNameSet = new Set<string>();
    const guestIdSet = new Set<string>();

    for (const gu of (guestUsers || [])) {
      if (gu.email) guestEmailSet.add(gu.email.toLowerCase().trim());
      const fullName = `${gu.firstName || ''} ${gu.lastName || ''}`.trim().toLowerCase();
      if (fullName) guestNameSet.add(fullName);
      if (gu.firstName) guestNameSet.add(gu.firstName.trim().toLowerCase());
      if (gu._id) guestIdSet.add(gu._id.toString());
    }

    // Filter calls to strictly exclude any data from Guest (resigned) users
    const activeCalls = (calls || []).filter((call: any) => {
      const rawEmail = (call.counselorEmail || '').toLowerCase().trim();
      const rawName = (call.agentName || call.counselorName || '').trim().toLowerCase();
      const rawUserId = call.userId ? String(call.userId) : '';

      if (
        (rawEmail && guestEmailSet.has(rawEmail)) ||
        (rawName && guestNameSet.has(rawName)) ||
        (rawUserId && guestIdSet.has(rawUserId))
      ) {
        return false;
      }
      return true;
    });

    // 2. Fetch active registered counselors to ensure proper name/team mapping (excluding superadmin, dummy, and guest/resigned users)
    const users = await (UserModel as any)
      .find({
        role: { $nin: ['SUPER_ADMIN', 'GUEST'] },
        isGuest: { $ne: true },
        email: { $nin: ['superadmin@academically.com', 'dummy@academically.com'] },
      })
      .sort({ firstName: 1 })
      .lean()
      .exec();

    const userByEmail = new Map<string, any>();
    const userByName = new Map<string, any>();

    const counselorMap = new Map<string, {
      agentName: string;
      counselorEmail: string;
      team: string;
      totalCalls: number;
      answeredCalls: number;
      unansweredCalls: number;
      outboundCalls: number;
      inboundCalls: number;
      whatsappCalls: number;
      totalDurationSeconds: number;
    }>();

    // 1. Pre-populate counselorMap with ALL registered users so everyone is included in the report
    for (const u of users) {
      const emailLower = (u.email || '').toLowerCase().trim();
      const displayName = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email;
      const team = u.team || 'General';

      userByEmail.set(emailLower, u);
      userByName.set(displayName.toLowerCase(), u);
      if (u.firstName) userByName.set(u.firstName.toLowerCase().trim(), u);

      if (emailLower && !counselorMap.has(emailLower)) {
        counselorMap.set(emailLower, {
          agentName: displayName,
          counselorEmail: emailLower,
          team: team,
          totalCalls: 0,
          answeredCalls: 0,
          unansweredCalls: 0,
          outboundCalls: 0,
          inboundCalls: 0,
          whatsappCalls: 0,
          totalDurationSeconds: 0,
        });
      }
    }

    let totalCalls = 0;
    let answeredCalls = 0;
    let unansweredCalls = 0;
    let outboundCalls = 0;
    let inboundCalls = 0;
    let whatsappCalls = 0;
    let totalDurationSeconds = 0;

    for (const call of activeCalls) {
      totalCalls++;

      const dirUpper = String(call.direction || '').trim().toUpperCase();
      const statusUpper = String(call.status || '').trim().toUpperCase();
      const channelUpper = String(call.channel || '').trim().toUpperCase();
      const dispLower = String(call.disposition || '').toLowerCase();
      const durSec = Math.max(0, Number(call.durationSeconds || 0));

      const isOutbound = dirUpper === 'OUTGOING' || dirUpper === 'OUTBOUND';
      const isInbound = dirUpper === 'INCOMING' || dirUpper === 'INBOUND' || dirUpper === 'MISSED';
      
      // Exact check: A call is answered if status is exactly 'ANSWERED' or positive duration and not missed/unanswered
      const isAnswered = statusUpper === 'ANSWERED' || (statusUpper !== 'UNANSWERED' && statusUpper !== 'MISSED' && statusUpper !== 'REJECTED' && durSec > 0);
      const isWhatsApp = channelUpper === 'WHATSAPP' || dispLower.includes('whatsapp');
      const duration = isAnswered ? durSec : 0;

      if (isOutbound) outboundCalls++;
      if (isInbound) inboundCalls++;
      if (isAnswered) {
        answeredCalls++;
        totalDurationSeconds += duration;
      } else {
        unansweredCalls++;
      }
      if (isWhatsApp) whatsappCalls++;

      // Counselor Key matching: email first, then agent name lookup
      const rawEmail = (call.counselorEmail || '').toLowerCase().trim();
      const rawName = (call.agentName || call.counselorName || 'Unknown Agent').trim();
      const matchedUser = (rawEmail ? userByEmail.get(rawEmail) : null) || userByName.get(rawName.toLowerCase());

      const matchedEmail = rawEmail || (matchedUser?.email ? matchedUser.email.toLowerCase().trim() : '');
      const key = matchedEmail || rawName.toLowerCase();

      if (!counselorMap.has(key)) {
        const displayName = matchedUser
          ? `${matchedUser.firstName || ''} ${matchedUser.lastName || ''}`.trim() || matchedUser.email
          : rawName;
        const team = call.team || matchedUser?.team || 'General';

        counselorMap.set(key, {
          agentName: displayName,
          counselorEmail: matchedEmail,
          team: team,
          totalCalls: 0,
          answeredCalls: 0,
          unansweredCalls: 0,
          outboundCalls: 0,
          inboundCalls: 0,
          whatsappCalls: 0,
          totalDurationSeconds: 0,
        });
      }

      const cData = counselorMap.get(key)!;
      cData.totalCalls++;
      if (isOutbound) cData.outboundCalls++;
      if (isInbound) cData.inboundCalls++;
      if (isAnswered) {
        cData.answeredCalls++;
        cData.totalDurationSeconds += duration;
      } else {
        cData.unansweredCalls++;
      }
      if (isWhatsApp) cData.whatsappCalls++;
    }

    const counselorsList: CounselorDailyStat[] = Array.from(counselorMap.values()).map((c) => {
      const connectRate = c.totalCalls > 0 ? `${((c.answeredCalls / c.totalCalls) * 100).toFixed(1)}%` : '0.0%';
      const avgDur = c.answeredCalls > 0 ? formatSecondsToTime(Math.round(c.totalDurationSeconds / c.answeredCalls)) : '0m 00s';
      return {
        ...c,
        formattedDuration: formatSecondsToTime(c.totalDurationSeconds),
        connectRate,
        avgDuration: avgDur,
      };
    });

    // Sort: Active callers first by total duration desc, then inactive callers by name asc
    counselorsList.sort((a, b) => {
      if (a.totalCalls > 0 && b.totalCalls === 0) return -1;
      if (a.totalCalls === 0 && b.totalCalls > 0) return 1;
      if (a.totalDurationSeconds !== b.totalDurationSeconds) {
        return b.totalDurationSeconds - a.totalDurationSeconds;
      }
      if (a.totalCalls !== b.totalCalls) {
        return b.totalCalls - a.totalCalls;
      }
      return a.agentName.localeCompare(b.agentName);
    });

    const overallConnectRate = totalCalls > 0 ? `${((answeredCalls / totalCalls) * 100).toFixed(1)}%` : '0%';
    const topPerformers = counselorsList.filter((c) => c.totalCalls > 0).slice(0, 3);
    const activeCounselorCount = counselorsList.filter((c) => c.totalCalls > 0).length;

    const data: DailyReportData = {
      reportDateFormatted: formattedDate,
      dateKey: dateStr,
      totalCalls,
      answeredCalls,
      unansweredCalls,
      outboundCalls,
      inboundCalls,
      whatsappCalls,
      totalDurationSeconds,
      formattedTotalDuration: formatSecondsToTime(totalDurationSeconds),
      connectRate: overallConnectRate,
      activeCounselorCount,
      counselors: counselorsList,
      topPerformers,
    };

    return { data, rawCalls: activeCalls };
  });
}

/**
 * Builds an Excel Workbook Buffer with Counselor Summary and Raw Call Logs
 */
export function buildReportExcelBuffer(data: DailyReportData, rawCalls: any[]): Buffer {
  const wb = XLSX.utils.book_new();

  // 1. Sheet: Counselor Daily Summary (Cleaned & Irrelevant Columns Removed)
  const counselorRows = data.counselors.map((c, index) => ({
    Rank: index + 1,
    'Counselor Name': c.agentName,
    Email: c.counselorEmail,
    'Total Calls': c.totalCalls,
    'Answered Calls': c.answeredCalls,
    'Missed / Unanswered': c.unansweredCalls,
    'Outbound Calls': c.outboundCalls,
    'Inbound Calls': c.inboundCalls,
    'WhatsApp Calls': c.whatsappCalls,
    'Total Talk Time': c.formattedDuration,
    'Connect Rate': c.connectRate,
    'Avg Call Duration': c.avgDuration,
  }));

  const wsSummary = XLSX.utils.json_to_sheet(counselorRows);

  // Set professional column widths for Counselor Summary
  wsSummary['!cols'] = [
    { wch: 6 },  // Rank
    { wch: 20 }, // Counselor Name
    { wch: 30 }, // Email
    { wch: 12 }, // Total Calls
    { wch: 15 }, // Answered Calls
    { wch: 20 }, // Missed / Unanswered
    { wch: 14 }, // Outbound Calls
    { wch: 14 }, // Inbound Calls
    { wch: 15 }, // WhatsApp Calls
    { wch: 16 }, // Total Talk Time
    { wch: 14 }, // Connect Rate
    { wch: 18 }, // Avg Call Duration
  ];

  XLSX.utils.book_append_sheet(wb, wsSummary, 'Counselor Summary');

  // 2. Sheet: Call Logs Breakdown (Cleaned & Formatted)
  const rawCallRows = rawCalls.slice(0, 5000).map((call, index) => {
    let callTimeIST = '';
    try {
      if (call.startTime) {
        callTimeIST = new Date(call.startTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
      }
    } catch {}

    return {
      '#': index + 1,
      'Date & Time (IST)': callTimeIST || call.startTime,
      'Counselor Name': call.agentName || call.counselorName || 'Unknown',
      'Counselor Email': call.counselorEmail || '',
      'Phone Number': call.phoneNumberMasked || call.phoneNumber || '',
      Direction: call.direction || 'OUTGOING',
      Status: call.status || 'UNKNOWN',
      'Talk Duration': formatSecondsToTime(call.durationSeconds || 0),
      Channel: call.channel || 'CELLULAR',
      'Device Model': call.deviceModel || '',
      'Recording Status': call.recordingStatus || 'NONE',
    };
  });

  const wsCalls = XLSX.utils.json_to_sheet(rawCallRows);

  // Set professional column widths for Call Details
  wsCalls['!cols'] = [
    { wch: 6 },  // #
    { wch: 22 }, // Date & Time (IST)
    { wch: 20 }, // Counselor Name
    { wch: 30 }, // Counselor Email
    { wch: 18 }, // Phone Number
    { wch: 12 }, // Direction
    { wch: 12 }, // Status
    { wch: 15 }, // Talk Duration
    { wch: 12 }, // Channel
    { wch: 18 }, // Device Model
    { wch: 16 }, // Recording Status
  ];

  XLSX.utils.book_append_sheet(wb, wsCalls, 'Call Details');

  const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return excelBuffer;
}

/**
 * Builds a styled, responsive HTML email template for the daily report
 */
export function buildDailyReportHtml(data: DailyReportData): string {
  const counselorRowsHtml = data.counselors
    .map((c, index) => {
      const isTop3 = index < 3;
      const rankBadge = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`;
      const rowBg = index % 2 === 0 ? '#ffffff' : '#f8fafc';

      return `
        <tr style="background-color: ${rowBg}; border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 10px 12px; font-weight: bold; color: ${isTop3 ? '#d97706' : '#64748b'}; text-align: center;">${rankBadge}</td>
          <td style="padding: 10px 12px; font-weight: 600; color: #1e293b;">
            ${c.agentName}
            ${c.counselorEmail ? `<div style="font-size: 11px; color: #64748b; font-weight: normal;">${c.counselorEmail}</div>` : ''}
          </td>
          <td style="padding: 10px 12px; text-align: center; color: #0f172a; font-weight: 600;">${c.totalCalls}</td>
          <td style="padding: 10px 12px; text-align: center; color: #16a34a; font-weight: 600;">${c.answeredCalls}</td>
          <td style="padding: 10px 12px; text-align: center; color: #dc2626;">${c.unansweredCalls}</td>
          <td style="padding: 10px 12px; text-align: center; color: #2563eb; font-weight: 600;">${c.formattedDuration}</td>
          <td style="padding: 10px 12px; text-align: center; font-weight: 600; color: #0f172a;">${c.connectRate}</td>
        </tr>
      `;
    })
    .join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily Calling Report - ${data.reportDateFormatted}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; margin: 0; padding: 24px; color: #334155;">
  <div style="max-width: 780px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); border: 1px solid #e2e8f0;">
    
    <!-- Header Banner -->
    <div style="background: linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%); padding: 28px 32px; color: #ffffff;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <span style="display: inline-block; background: rgba(255, 255, 255, 0.15); color: #e0e7ff; font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 20px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">
            Automated Operations Report
          </span>
          <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;">RecordHub Daily Calling Report</h1>
          <p style="margin: 6px 0 0 0; color: #c7d2fe; font-size: 14px;">📅 Date: <strong>${data.reportDateFormatted}</strong></p>
        </div>
      </div>
    </div>

    <!-- Body Content -->
    <div style="padding: 28px 32px;">
      
      <!-- Executive Summary Cards -->
      <h2 style="font-size: 16px; text-transform: uppercase; color: #475569; font-weight: 700; letter-spacing: 0.5px; margin: 0 0 16px 0;">
        📈 Executive Summary
      </h2>

      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
        <tr>
          <td width="25%" style="padding: 6px;">
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; text-align: center;">
              <div style="font-size: 12px; color: #64748b; font-weight: 600; text-transform: uppercase;">Total Calls</div>
              <div style="font-size: 22px; font-weight: 700; color: #0f172a; margin-top: 4px;">${data.totalCalls}</div>
            </div>
          </td>
          <td width="25%" style="padding: 6px;">
            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 14px; text-align: center;">
              <div style="font-size: 12px; color: #166534; font-weight: 600; text-transform: uppercase;">Answered</div>
              <div style="font-size: 22px; font-weight: 700; color: #15803d; margin-top: 4px;">${data.answeredCalls}</div>
            </div>
          </td>
          <td width="25%" style="padding: 6px;">
            <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 14px; text-align: center;">
              <div style="font-size: 12px; color: #1e40af; font-weight: 600; text-transform: uppercase;">Total Talk Time</div>
              <div style="font-size: 20px; font-weight: 700; color: #1d4ed8; margin-top: 4px;">${data.formattedTotalDuration}</div>
            </div>
          </td>
          <td width="25%" style="padding: 6px;">
            <div style="background: #faf5ff; border: 1px solid #e9d5ff; border-radius: 8px; padding: 14px; text-align: center;">
              <div style="font-size: 12px; color: #6b21a8; font-weight: 600; text-transform: uppercase;">Connect Rate</div>
              <div style="font-size: 22px; font-weight: 700; color: #7e22ce; margin-top: 4px;">${data.connectRate}</div>
            </div>
          </td>
        </tr>
      </table>

      <!-- Secondary KPI Metrics Row -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 28px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; padding: 12px;">
        <tr>
          <td style="padding: 6px 12px; font-size: 13px; color: #475569;"><strong>Active Counselors:</strong> ${data.activeCounselorCount} / ${data.counselors.length}</td>
          <td style="padding: 6px 12px; font-size: 13px; color: #475569;"><strong>Outbound Calls:</strong> ${data.outboundCalls}</td>
          <td style="padding: 6px 12px; font-size: 13px; color: #475569;"><strong>Inbound Calls:</strong> ${data.inboundCalls}</td>
          <td style="padding: 6px 12px; font-size: 13px; color: #475569;"><strong>WhatsApp Calls:</strong> ${data.whatsappCalls}</td>
        </tr>
      </table>

      <!-- Counselor Performance Table -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <h2 style="font-size: 16px; text-transform: uppercase; color: #475569; font-weight: 700; letter-spacing: 0.5px; margin: 0;">
          👥 Counselor Performance Breakdown
        </h2>
      </div>

      <div style="border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; margin-bottom: 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse; font-size: 13px;">
          <thead>
            <tr style="background-color: #f1f5f9; border-bottom: 2px solid #cbd5e1; text-align: left;">
              <th style="padding: 10px 12px; color: #475569; font-weight: 700; text-align: center; width: 45px;">Rank</th>
              <th style="padding: 10px 12px; color: #475569; font-weight: 700;">Counselor</th>
              <th style="padding: 10px 12px; color: #475569; font-weight: 700; text-align: center;">Calls</th>
              <th style="padding: 10px 12px; color: #475569; font-weight: 700; text-align: center;">Connected</th>
              <th style="padding: 10px 12px; color: #475569; font-weight: 700; text-align: center;">Missed</th>
              <th style="padding: 10px 12px; color: #475569; font-weight: 700; text-align: center;">Talk Duration</th>
              <th style="padding: 10px 12px; color: #475569; font-weight: 700; text-align: center;">Connect %</th>
            </tr>
          </thead>
          <tbody>
            ${counselorRowsHtml || '<tr><td colspan="7" style="padding: 20px; text-align: center; color: #94a3b8;">No call activity recorded for this day.</td></tr>'}
          </tbody>
        </table>
      </div>

      <!-- Attachment Banner -->
      <div style="background-color: #f0fdf4; border: 1px dashed #86efac; border-radius: 8px; padding: 14px 18px; margin-bottom: 24px;">
        <div style="display: flex; align-items: center;">
          <span style="font-size: 20px; margin-right: 10px;">📎</span>
          <div>
            <strong style="color: #166534; font-size: 13px;">Detailed Excel Report Attached</strong>
            <div style="font-size: 12px; color: #15803d; margin-top: 2px;">
              The attached spreadsheet <code>RecordHub_Daily_Report_${data.dateKey}.xlsx</code> includes complete counselor metrics and full call records.
            </div>
          </div>
        </div>
      </div>

      <!-- Footer Note -->
      <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; font-size: 11px; color: #94a3b8; text-align: center;">
        <p style="margin: 0;">This is an automated operational report generated by RecordHub Intelligence System.</p>
        <p style="margin: 4px 0 0 0;">For queries or adjustments, please contact the System Administrator.</p>
      </div>

    </div>
  </div>
</body>
</html>
  `;
}
