'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Navigation, useUserRole } from '@/components/Navigation';
import { UserProfileMenu } from '@/components/UserProfileMenu';
import * as XLSX from 'xlsx';
import {
  History,
  Search,
  Filter,
  RefreshCw,
  Download,
  Calendar,
  User,
  Shield,
  ShieldCheck,
  Clock,
  Laptop,
  Globe,
  Eye,
  X,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Headphones,
  FileSpreadsheet,
  Monitor,
  UserCheck,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Users,
  Play,
  ArrowUpDown,
  Flame,
  Radio,
  SlidersHorizontal,
  KeyRound,
  FileText
} from 'lucide-react';
import Link from 'next/link';

interface ActivityActionItem {
  _id?: string;
  action: string;
  actionCategory?: string;
  description: string;
  path?: string;
  details?: Record<string, any>;
  timestamp: string;
}

interface ActivityLogItem {
  _id: string;
  sessionId?: string;
  userEmail: string;
  userName?: string;
  userRole?: string;
  startedAt?: string;
  lastActiveAt?: string;
  durationMinutes?: number;
  ipAddress?: string;
  userAgent?: string;
  device?: string;
  currentPath?: string;
  status?: string;
  totalActions?: number;
  latestActivity?: ActivityActionItem;
  activities?: ActivityActionItem[];
  isOnline?: boolean;
  action?: string;
  actionCategory?: string;
  description?: string;
  targetResource?: string;
  path?: string;
  details?: Record<string, any>;
  timestamp?: string;
}

interface ActiveUserSummary {
  userEmail: string;
  userName: string;
  userRole: string;
  lastActive: string;
  lastAction: string;
  lastActionCode?: string;
  lastPage?: string;
  device?: string;
  ipAddress?: string;
  actionsCount: number;
  isOnline: boolean;
}

interface ActivityStats {
  totalDashboardOpensToday: number;
  uniqueUsersToday: number;
  totalRecordingsPlayedToday: number;
  totalActionsToday: number;
  activeUsers: ActiveUserSummary[];
  categoryBreakdown: { _id: string; count: number }[];
}

export default function ActivityAuditPage() {
  const { role: userRole, email: currentUserEmail, isAdmin, isSuperAdmin, mounted } = useUserRole();
  const hasAccess = isAdmin || isSuperAdmin;

  // Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState('all');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [dateRange, setDateRange] = useState('Today');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  // Pagination States
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [totalPages, setTotalPages] = useState(1);
  const [totalLogs, setTotalLogs] = useState(0);

  // Data States
  const [logs, setLogs] = useState<ActivityLogItem[]>([]);
  const [stats, setStats] = useState<ActivityStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [expandedSessions, setExpandedSessions] = useState<Record<string, boolean>>({});

  // Modal State for inspecting single activity
  const [inspectLog, setInspectLog] = useState<ActivityLogItem | null>(null);

  // User options list for filter dropdown
  const [usersList, setUsersList] = useState<Array<{ email: string; name: string; role: string }>>([]);

  const isFetchingRef = useRef(false);

  const fetchActivities = useCallback(async (isSilent = false) => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    if (!isSilent) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const params = new URLSearchParams();
      params.set('page', page.toString());
      params.set('limit', limit.toString());

      if (selectedUser && selectedUser !== 'all') {
        params.set('userEmail', selectedUser);
      }
      if (selectedCategory && selectedCategory !== 'all') {
        params.set('category', selectedCategory);
      }
      if (dateRange) {
        params.set('dateRange', dateRange);
      }
      if (dateRange === 'Custom') {
        if (customStartDate) params.set('startDate', customStartDate);
        if (customEndDate) params.set('endDate', customEndDate);
      }
      if (searchQuery.trim()) {
        params.set('search', searchQuery.trim());
      }

      const res = await fetch(`/api/v1/activity?${params.toString()}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
        setTotalLogs(data.total || 0);
        setTotalPages(data.totalPages || 1);
        if (data.stats) {
          setStats(data.stats);
        }
        setLastUpdated(new Date());
      }
    } catch (err) {
      console.error('Error loading activity logs:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
      isFetchingRef.current = false;
    }
  }, [page, limit, selectedUser, selectedCategory, dateRange, customStartDate, customEndDate, searchQuery]);

  // Fetch counselor list for user filter dropdown
  useEffect(() => {
    fetch('/api/v1/auth/counselors', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          const formatted = data.map((u: any) => ({
            email: u.email || '',
            name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email?.split('@')[0],
            role: u.role || 'COUNSELOR',
          })).filter((u: any) => Boolean(u.email));
          setUsersList(formatted);
        }
      })
      .catch(() => {});
  }, []);

  // Fetch logs on filter changes
  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  // Auto-refresh timer every 15s when active
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && !document.hidden && document.visibilityState === 'visible') {
        fetchActivities(true);
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchActivities]);

  // Format relative time helper
  const formatRelativeTime = (timestampStr: string) => {
    if (!timestampStr) return '-';
    const date = new Date(timestampStr);
    const now = new Date();
    const diffSecs = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));

    if (diffSecs < 45) return 'Just now';
    if (diffSecs < 90) return '1m ago';
    if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)}m ago`;
    if (diffSecs < 86400) return `${Math.floor(diffSecs / 3600)}h ago`;
    const diffDays = Math.floor(diffSecs / 86400);
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
  };

  const formatExactTime = (timestampStr: string) => {
    if (!timestampStr) return '-';
    const date = new Date(timestampStr);
    return date.toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  };

  const getRoleBadge = (role: string = '') => {
    const r = role.toUpperCase();
    if (r === 'SUPER_ADMIN') {
      return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-200">Super Admin</span>;
    }
    if (r === 'ADMIN' || r === 'COMPANY_ADMIN') {
      return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">Admin</span>;
    }
    if (r === 'MANAGER' || r === 'TEAM_LEAD') {
      return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200">Lead</span>;
    }
    return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Counselor</span>;
  };

  const getActionStyle = (action: string, category: string = '') => {
    const act = (action || '').toUpperCase();
    const cat = (category || '').toUpperCase();

    if (act.includes('OPEN_DASHBOARD') || cat === 'DASHBOARD') {
      return {
        icon: Monitor,
        bg: 'bg-indigo-50 text-indigo-700 border-indigo-200',
        dot: 'bg-indigo-500',
        label: 'Dashboard Open',
      };
    }
    if (act.includes('RECORDING') || cat === 'RECORDINGS') {
      return {
        icon: Headphones,
        bg: 'bg-amber-50 text-amber-700 border-amber-200',
        dot: 'bg-amber-500',
        label: 'Audio Recording',
      };
    }
    if (act.includes('EXPORT') || cat === 'EXPORTS') {
      return {
        icon: FileSpreadsheet,
        bg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        dot: 'bg-emerald-500',
        label: 'Data Export',
      };
    }
    if (act.includes('LOGIN') || act.includes('AUTH') || cat === 'AUTH') {
      return {
        icon: KeyRound,
        bg: 'bg-teal-50 text-teal-700 border-teal-200',
        dot: 'bg-teal-500',
        label: 'Authentication',
      };
    }
    if (act.includes('USER') || cat === 'USER_MANAGEMENT') {
      return {
        icon: UserCheck,
        bg: 'bg-purple-50 text-purple-700 border-purple-200',
        dot: 'bg-purple-500',
        label: 'User Admin',
      };
    }
    if (act.includes('TEAM') || cat === 'TEAM_MANAGEMENT') {
      return {
        icon: Users,
        bg: 'bg-blue-50 text-blue-700 border-blue-200',
        dot: 'bg-blue-500',
        label: 'Team Admin',
      };
    }
    if (act.includes('SETTING') || cat === 'SETTINGS') {
      return {
        icon: Shield,
        bg: 'bg-rose-50 text-rose-700 border-rose-200',
        dot: 'bg-rose-500',
        label: 'Settings',
      };
    }

    return {
      icon: Clock,
      bg: 'bg-slate-100 text-slate-700 border-slate-200',
      dot: 'bg-slate-400',
      label: 'Activity',
    };
  };

  // Export to Excel function
  const handleExportExcel = () => {
    if (!logs.length) return;

    // Sheet 1: User Sessions Summary (1 entry per login session)
    const sessionsSummary = logs.map((sess) => ({
      'Session ID': sess.sessionId || sess._id,
      'User Name': sess.userName || sess.userEmail.split('@')[0],
      'User Email': sess.userEmail,
      'User Role': sess.userRole || 'COUNSELOR',
      'Session Started': sess.startedAt ? formatExactTime(sess.startedAt) : '-',
      'Last Active': sess.lastActiveAt ? formatExactTime(sess.lastActiveAt) : (sess.timestamp ? formatExactTime(sess.timestamp) : '-'),
      'Duration (Mins)': sess.durationMinutes || 1,
      'Online Status': sess.isOnline ? 'Online Now' : (sess.status || 'Active'),
      'Total Actions': sess.totalActions || sess.activities?.length || 1,
      'Latest Action': sess.latestActivity?.action || sess.action || 'OPEN_DASHBOARD',
      'Latest Description': sess.latestActivity?.description || sess.description || '',
      'Latest Path': sess.latestActivity?.path || sess.path || '/dashboard',
      'Device': sess.device || 'Desktop Web',
      'IP Address': sess.ipAddress || '-',
    }));

    // Sheet 2: All Activities Nested In Sessions
    const allActivities: any[] = [];
    logs.forEach((sess) => {
      const acts = sess.activities && sess.activities.length > 0
        ? sess.activities
        : [{
            action: sess.action || 'OPEN_DASHBOARD',
            actionCategory: sess.actionCategory || 'GENERAL',
            description: sess.description || 'Active on dashboard',
            path: sess.path || '/dashboard',
            timestamp: sess.timestamp || sess.startedAt || new Date().toISOString(),
            details: sess.details || {},
          }];

      acts.forEach((act, idx) => {
        allActivities.push({
          'Session ID': sess.sessionId || sess._id,
          'User Name': sess.userName || sess.userEmail.split('@')[0],
          'User Email': sess.userEmail,
          'User Role': sess.userRole || 'COUNSELOR',
          'Action #': acts.length - idx,
          'Action Timestamp': formatExactTime(act.timestamp),
          'Action Code': act.action,
          'Category': act.actionCategory || 'GENERAL',
          'Description / What They Did': act.description,
          'Page / URL': act.path || '/',
          'Device': sess.device || 'Desktop Web',
          'IP Address': sess.ipAddress || '-',
          'Metadata': act.details ? JSON.stringify(act.details) : '',
        });
      });
    });

    const workbook = XLSX.utils.book_new();
    const wsSessions = XLSX.utils.json_to_sheet(sessionsSummary);
    XLSX.utils.book_append_sheet(workbook, wsSessions, 'User Sessions');

    if (allActivities.length > 0) {
      const wsActivities = XLSX.utils.json_to_sheet(allActivities);
      XLSX.utils.book_append_sheet(workbook, wsActivities, 'All Actions Stream');
    }

    const dateStr = new Date().toISOString().split('T')[0];
    XLSX.writeFile(workbook, `RecorderHub_User_Session_Audit_${dateStr}.xlsx`);
  };

  // Reset all filters
  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedUser('all');
    setSelectedCategory('all');
    setDateRange('Today');
    setCustomStartDate('');
    setCustomEndDate('');
    setPage(1);
  };

  if (mounted && !hasAccess) {
    return (
      <div className="flex min-h-screen bg-[#f8fafc] text-slate-900 font-sans">
        <Navigation />
        <main className="flex-1 p-8 flex items-center justify-center">
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-5 max-w-lg mx-auto shadow-sm">
            <div className="w-16 h-16 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto border border-rose-100 shadow-sm">
              <Shield className="w-8 h-8 text-rose-600" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight">System Admin Access Only</h2>
              <p className="text-xs text-slate-500 leading-relaxed max-w-sm mx-auto">
                User activity logs, dashboard access history, and forensic audit records are strictly restricted to System Administrators.
              </p>
            </div>
            <div className="pt-2">
              <Link
                href="/dashboard"
                className="inline-flex items-center space-x-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs px-5 py-2.5 rounded-xl transition-all shadow-md"
              >
                <span>Return to Analytics Dashboard</span>
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#f8fafc] text-slate-900 font-sans overflow-hidden">
      {/* Sidebar Navigation */}
      <Navigation />

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto p-6 lg:p-8 space-y-6">
        {/* Top Header Bar */}
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200/80">
          <div>
            <div className="flex items-center space-x-3">
              <div className="w-9 h-9 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-600 shadow-sm">
                <History className="w-5 h-5 text-rose-600" />
              </div>
              <div>
                <h1 className="text-2xl font-black text-slate-900 tracking-tight flex items-center space-x-2">
                  <span>User Activity & Audit Logs</span>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                    Live Audit Trail
                  </span>
                </h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  Real-time visibility into which user opened the dashboard, when they accessed it, and what actions they performed.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-3 self-end sm:self-auto">
            {/* Auto-Refresh Toggle */}
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                autoRefresh
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
              title="Toggle automatic live updates every 15 seconds"
            >
              <span className={`w-2 h-2 rounded-full ${autoRefresh ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
              <span>{autoRefresh ? 'Live Auto-Sync (15s)' : 'Auto-Sync Paused'}</span>
            </button>

            {/* Manual Refresh Button */}
            <button
              onClick={() => fetchActivities(false)}
              disabled={loading || refreshing}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 shadow-sm transition-all cursor-pointer disabled:opacity-50"
              title="Refresh now"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${refreshing || loading ? 'animate-spin text-rose-600' : ''}`} />
              <span>Refresh</span>
            </button>

            {/* Export to Excel */}
            <button
              onClick={handleExportExcel}
              disabled={logs.length === 0}
              className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white shadow-sm transition-all cursor-pointer disabled:opacity-40"
              title="Export filtered audit logs to Excel (.xlsx)"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Excel</span>
            </button>

            {/* Profile Menu */}
            <UserProfileMenu />
          </div>
        </header>

        {/* 4 Metric KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Dashboard Opens Today */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs relative overflow-hidden group hover:border-indigo-300 transition-all">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Dashboard Opens</span>
              <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
                <Monitor className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline space-x-2">
              <span className="text-3xl font-black text-slate-900">
                {stats?.totalDashboardOpensToday ?? 0}
              </span>
              <span className="text-xs text-indigo-600 font-bold">today</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1 flex items-center space-x-1">
              <span>Opened by team members & leads</span>
            </p>
          </div>

          {/* Card 2: Active Users Today */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs relative overflow-hidden group hover:border-emerald-300 transition-all">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Active Users Today</span>
              <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600">
                <Users className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline space-x-2">
              <span className="text-3xl font-black text-slate-900">
                {stats?.uniqueUsersToday ?? 0}
              </span>
              <span className="text-xs text-emerald-600 font-bold">unique</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              {stats?.activeUsers?.filter((u) => u.isOnline).length || 0} online in last 15 mins
            </p>
          </div>

          {/* Card 3: Recordings Audited / Listened */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs relative overflow-hidden group hover:border-amber-300 transition-all">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Recordings Listened</span>
              <div className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600">
                <Headphones className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline space-x-2">
              <span className="text-3xl font-black text-slate-900">
                {stats?.totalRecordingsPlayedToday ?? 0}
              </span>
              <span className="text-xs text-amber-600 font-bold">plays</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">Call audio QA & reviews logged today</p>
          </div>

          {/* Card 4: Total Logged Actions */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs relative overflow-hidden group hover:border-rose-300 transition-all">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Actions Today</span>
              <div className="w-9 h-9 rounded-xl bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-600">
                <ShieldCheck className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline space-x-2">
              <span className="text-3xl font-black text-slate-900">
                {stats?.totalActionsToday ?? 0}
              </span>
              <span className="text-xs text-rose-600 font-bold">logged</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">Total forensic events tracked</p>
          </div>
        </div>

        {/* "Who Opened the Dashboard / Last Active Team Members" Strip */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Radio className="w-4 h-4 text-emerald-500 animate-pulse" />
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-wide">
                Recent User Activity & Dashboard Sessions
              </h3>
              <span className="text-xs text-slate-400 font-medium">
                (Click any user to filter their history)
              </span>
            </div>
            {selectedUser !== 'all' && (
              <button
                onClick={() => setSelectedUser('all')}
                className="text-xs font-bold text-rose-600 hover:text-rose-700 flex items-center space-x-1"
              >
                <span>Clear user filter</span>
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-3 overflow-x-auto pb-2 scrollbar-thin">
            {(!stats?.activeUsers || stats.activeUsers.length === 0) ? (
              <div className="text-xs text-slate-400 py-3 italic">
                No active user sessions recorded in the last 24 hours.
              </div>
            ) : (
              stats.activeUsers.map((user) => {
                const isSelected = selectedUser.toLowerCase() === user.userEmail.toLowerCase();
                return (
                  <button
                    key={user.userEmail}
                    onClick={() => {
                      setSelectedUser(isSelected ? 'all' : user.userEmail);
                      setPage(1);
                    }}
                    className={`flex items-start space-x-3 p-3 rounded-xl border text-left shrink-0 transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-rose-50/70 border-rose-300 ring-2 ring-rose-500/20'
                        : 'bg-slate-50 hover:bg-slate-100/80 border-slate-200'
                    }`}
                    style={{ minWidth: '220px', maxWidth: '260px' }}
                  >
                    {/* User Avatar with status dot */}
                    <div className="relative shrink-0 mt-0.5">
                      <div className="w-8 h-8 rounded-full bg-slate-200 text-slate-700 font-bold flex items-center justify-center text-xs">
                        {user.userName.charAt(0).toUpperCase()}
                      </div>
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${
                          user.isOnline ? 'bg-emerald-500' : 'bg-slate-400'
                        }`}
                        title={user.isOnline ? 'Online now (active < 15m)' : 'Offline / Idle'}
                      />
                    </div>

                    <div className="overflow-hidden min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-900 truncate">
                          {user.userName}
                        </span>
                        <span className="text-[10px] text-slate-400 shrink-0 font-medium ml-1">
                          {formatRelativeTime(user.lastActive)}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 truncate mt-0.5">
                        {user.lastAction || 'Active on dashboard'}
                      </p>
                      <div className="flex items-center space-x-1.5 mt-1.5">
                        {getRoleBadge(user.userRole)}
                        <span className="text-[10px] text-slate-400 font-mono">
                          {user.actionsCount} actions
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Filter Controls Bar */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Search Input */}
            <div className="relative flex-1 min-w-[240px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="Search user email, action, description, IP, or device..."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-9 py-2 text-xs font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:bg-white transition-all"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 p-0.5 rounded"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* User Dropdown Filter */}
            <div className="relative min-w-[180px]">
              <select
                value={selectedUser}
                onChange={(e) => {
                  setSelectedUser(e.target.value);
                  setPage(1);
                }}
                className="w-full appearance-none bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 pr-8 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-rose-500/20 cursor-pointer"
              >
                <option value="all">All Users ({usersList.length || 'All'})</option>
                {usersList.map((u) => (
                  <option key={u.email} value={u.email}>
                    {u.name} ({u.role})
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-2.5 pointer-events-none" />
            </div>

            {/* Category Dropdown Filter */}
            <div className="relative min-w-[170px]">
              <select
                value={selectedCategory}
                onChange={(e) => {
                  setSelectedCategory(e.target.value);
                  setPage(1);
                }}
                className="w-full appearance-none bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 pr-8 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-rose-500/20 cursor-pointer"
              >
                <option value="all">All Categories</option>
                <option value="DASHBOARD">📊 Dashboard Opens</option>
                <option value="RECORDINGS">🎧 Recordings Listened</option>
                <option value="CALLS">📞 Call Log Views</option>
                <option value="EXPORTS">📥 Excel / CSV Exports</option>
                <option value="USER_MANAGEMENT">👤 User Management</option>
                <option value="TEAM_MANAGEMENT">👥 Team Management</option>
                <option value="AUTH">🔑 Logins & Sessions</option>
                <option value="SETTINGS">⚙️ System Settings</option>
              </select>
              <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-2.5 pointer-events-none" />
            </div>

            {/* Date Range Selector */}
            <div className="relative min-w-[140px]">
              <select
                value={dateRange}
                onChange={(e) => {
                  setDateRange(e.target.value);
                  setPage(1);
                }}
                className="w-full appearance-none bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 pr-8 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-rose-500/20 cursor-pointer"
              >
                <option value="Today">Today</option>
                <option value="Yesterday">Yesterday</option>
                <option value="Last 24 hours">Last 24 hours</option>
                <option value="This week">This week</option>
                <option value="Last 7 days">Last 7 days</option>
                <option value="This month">This month</option>
                <option value="Last month">Last month</option>
                <option value="Last 30 days">Last 30 days</option>
                <option value="Custom">Custom Dates</option>
              </select>
              <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-2.5 pointer-events-none" />
            </div>

            {/* Reset Filters */}
            {(searchQuery || selectedUser !== 'all' || selectedCategory !== 'all' || dateRange !== 'Today') && (
              <button
                onClick={handleResetFilters}
                className="flex items-center space-x-1 px-3 py-2 text-xs font-bold text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-xl border border-rose-200 transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
            )}
          </div>

          {/* Custom Date Inputs if 'Custom' selected */}
          {dateRange === 'Custom' && (
            <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100 animate-in fade-in">
              <div className="flex items-center space-x-2 text-xs">
                <span className="font-semibold text-slate-500">From Date:</span>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => {
                    setCustomStartDate(e.target.value);
                    setPage(1);
                  }}
                  className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-800 font-medium focus:outline-none focus:ring-1 focus:ring-rose-500"
                />
              </div>
              <div className="flex items-center space-x-2 text-xs">
                <span className="font-semibold text-slate-500">To Date:</span>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => {
                    setCustomEndDate(e.target.value);
                    setPage(1);
                  }}
                  className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-800 font-medium focus:outline-none focus:ring-1 focus:ring-rose-500"
                />
              </div>
            </div>
          )}
        </div>

        {/* Activity Logs Table */}
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200/80 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <h2 className="text-sm font-black text-slate-900 uppercase tracking-wide">
                Activity Audit Trail
              </h2>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                {totalLogs} {totalLogs === 1 ? 'event' : 'events'}
              </span>
            </div>
            <div className="text-[11px] text-slate-400">
              Last synced: {lastUpdated.toLocaleTimeString()}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/70 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="py-3 px-4">User</th>
                  <th className="py-3 px-4">Session Timing</th>
                  <th className="py-3 px-4">Total Actions</th>
                  <th className="py-3 px-4">Latest Action</th>
                  <th className="py-3 px-4">Device & IP</th>
                  <th className="py-3 px-4">Last Active</th>
                  <th className="py-3 px-3 text-right">Session Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="py-16 text-center text-slate-400 space-y-3">
                      <RefreshCw className="w-6 h-6 animate-spin text-rose-500 mx-auto" />
                      <p className="font-semibold text-xs text-slate-600">Loading audit activity sessions...</p>
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-16 text-center text-slate-400 space-y-3">
                      <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mx-auto">
                        <History className="w-6 h-6" />
                      </div>
                      <p className="font-bold text-slate-700 text-sm">No activity sessions found</p>
                      <p className="text-xs text-slate-400 max-w-sm mx-auto">
                        No activity records matched your filter criteria. Try resetting the filters or selecting a different date range.
                      </p>
                      <button
                        onClick={handleResetFilters}
                        className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition-colors"
                      >
                        <span>Reset All Filters</span>
                      </button>
                    </td>
                  </tr>
                ) : (
                  logs.map((session) => {
                    const sessionActs = session.activities || [];
                    const latestAct = session.latestActivity || (sessionActs.length > 0 ? sessionActs[0] : null) || {
                      action: session.action || 'OPEN_DASHBOARD',
                      actionCategory: session.actionCategory || 'GENERAL',
                      description: session.description || 'Active on dashboard',
                      path: session.path || '/dashboard',
                      timestamp: session.lastActiveAt || session.timestamp || session.startedAt,
                    };
                    const sId = session._id || session.sessionId;
                    const isExpanded = Boolean(expandedSessions[sId]);
                    const style = getActionStyle(latestAct.action, latestAct.actionCategory);
                    const ActionIcon = style.icon;

                    const startedDate = new Date(session.startedAt || session.timestamp || Date.now());
                    const lastActiveDate = new Date(session.lastActiveAt || session.timestamp || Date.now());
                    const diffMins = Math.max(0, Math.floor((Date.now() - lastActiveDate.getTime()) / 60000));
                    const isOnline = session.isOnline !== undefined ? session.isOnline : (diffMins < 15);

                    return (
                      <React.Fragment key={sId}>
                        <tr className={`hover:bg-slate-50/80 transition-colors group ${isExpanded ? 'bg-slate-50/60' : ''}`}>
                          {/* User Info */}
                          <td className="py-3 px-4 whitespace-nowrap">
                            <div className="flex items-center space-x-2.5">
                              <div className="relative shrink-0">
                                <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 text-slate-800 font-bold flex items-center justify-center text-xs">
                                  {(session.userName || session.userEmail).charAt(0).toUpperCase()}
                                </div>
                                <span
                                  className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${
                                    isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
                                  }`}
                                  title={isOnline ? 'Online now (active < 15m)' : 'Idle / Offline'}
                                />
                              </div>
                              <div className="overflow-hidden min-w-0">
                                <div className="font-bold text-slate-900 truncate">
                                  {session.userName || session.userEmail.split('@')[0]}
                                </div>
                                <div className="text-[11px] text-slate-400 truncate font-mono">
                                  {session.userEmail}
                                </div>
                                <div className="mt-0.5">
                                  {getRoleBadge(session.userRole)}
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Session Timing */}
                          <td className="py-3 px-4 whitespace-nowrap">
                            <div className="space-y-0.5">
                              <div className="flex items-center space-x-1.5 text-xs font-semibold text-slate-800">
                                <Clock className="w-3.5 h-3.5 text-indigo-500" />
                                <span>Started: {startedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                              </div>
                              <div className="text-[11px] text-slate-500">
                                Active for <span className="font-bold text-slate-700">{session.durationMinutes || 1}m</span>
                              </div>
                              <div>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border inline-block ${
                                  isOnline
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : 'bg-slate-100 text-slate-600 border-slate-200'
                                }`}>
                                  {isOnline ? 'Online Now' : 'Completed / Idle'}
                                </span>
                              </div>
                            </div>
                          </td>

                          {/* Total Actions + Expand Trigger */}
                          <td className="py-3 px-4 whitespace-nowrap">
                            <button
                              onClick={() => setExpandedSessions((prev) => ({ ...prev, [sId]: !prev[sId] }))}
                              className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                                isExpanded
                                  ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                                  : 'bg-slate-100 hover:bg-slate-200/80 text-slate-700 border-slate-200'
                              }`}
                              title="Click to view all activity steps in this session"
                            >
                              <span>{session.totalActions || sessionActs.length} {sessionActs.length === 1 ? 'action' : 'actions'}</span>
                              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                            </button>
                          </td>

                          {/* Latest Action Badge & Description */}
                          <td className="py-3 px-4">
                            <div className="space-y-1 max-w-sm">
                              <div className="flex items-center space-x-1.5">
                                <span className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-md border text-[10px] font-bold ${style.bg}`}>
                                  <ActionIcon className="w-3 h-3" />
                                  <span className="font-mono">{latestAct.action}</span>
                                </span>
                                <span className="text-[10px] font-mono text-slate-400 truncate">
                                  {latestAct.path || session.currentPath || '/dashboard'}
                                </span>
                              </div>
                              <p className="font-semibold text-slate-800 text-xs truncate">
                                {latestAct.description || 'Active on dashboard'}
                              </p>
                            </div>
                          </td>

                          {/* Device & Client IP */}
                          <td className="py-3 px-4 whitespace-nowrap">
                            <div className="space-y-0.5">
                              <div className="text-[11px] font-medium text-slate-700 flex items-center space-x-1">
                                <Laptop className="w-3 h-3 text-slate-400" />
                                <span>{session.device || 'Desktop Web'}</span>
                              </div>
                              <div className="text-[10px] font-mono text-slate-400 flex items-center space-x-1">
                                <Globe className="w-2.5 h-2.5 text-slate-400" />
                                <span>{session.ipAddress || '127.0.0.1'}</span>
                              </div>
                            </div>
                          </td>

                          {/* Last Active Timestamp */}
                          <td className="py-3 px-4 whitespace-nowrap">
                            <div className="space-y-0.5">
                              <span className="font-bold text-slate-800 text-xs block">
                                {formatRelativeTime(session.lastActiveAt || session.timestamp || session.startedAt)}
                              </span>
                              <span className="text-[10px] text-slate-400 block font-mono">
                                {formatExactTime(session.lastActiveAt || session.timestamp || session.startedAt)}
                              </span>
                            </div>
                          </td>

                          {/* Action Buttons */}
                          <td className="py-3 px-3 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end space-x-1.5">
                              <button
                                onClick={() => setExpandedSessions((prev) => ({ ...prev, [sId]: !prev[sId] }))}
                                className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                                  isExpanded
                                    ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                                    : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100 border-transparent'
                                }`}
                                title={isExpanded ? 'Collapse session history' : 'Expand session history'}
                              >
                                <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                              </button>
                              <button
                                onClick={() => setInspectLog(session)}
                                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                                title="Inspect full session forensic details"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>

                        {/* Expandable Nested Session Activities Sub-Row */}
                        {isExpanded && (
                          <tr className="bg-slate-50/80 border-b border-slate-200">
                            <td colSpan={7} className="p-4 pl-12 pr-6">
                              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs space-y-3">
                                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                                  <div className="flex items-center space-x-2">
                                    <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                                    <h4 className="text-xs font-bold text-slate-900">
                                      Session Activity Breakdown ({session.userName || session.userEmail})
                                    </h4>
                                    <span className="text-[10px] font-mono text-slate-400">
                                      Session ID: {session.sessionId || session._id}
                                    </span>
                                  </div>
                                  <span className="text-[11px] text-slate-500 font-semibold">
                                    {sessionActs.length} {sessionActs.length === 1 ? 'action recorded' : 'actions recorded in this login session'}
                                  </span>
                                </div>

                                {sessionActs.length === 0 ? (
                                  <div className="text-xs text-slate-400 italic py-2">
                                    No granular actions logged for this session.
                                  </div>
                                ) : (
                                  <div className="space-y-2 max-h-80 overflow-y-auto pr-2">
                                    {sessionActs.map((act, actIdx) => {
                                      const actStyle = getActionStyle(act.action, act.actionCategory);
                                      const ActIcon = actStyle.icon;
                                      const actTime = new Date(act.timestamp || Date.now());

                                      return (
                                        <div
                                          key={act._id || actIdx}
                                          className="flex items-start justify-between p-2.5 rounded-lg bg-slate-50 hover:bg-slate-100/90 border border-slate-200/70 transition-all text-xs"
                                        >
                                          <div className="flex items-start space-x-3 min-w-0 flex-1">
                                            <span className="text-[10px] font-mono font-bold text-slate-400 mt-1 shrink-0 w-6">
                                              #{sessionActs.length - actIdx}
                                            </span>

                                            <span className={`inline-flex items-center space-x-1.5 px-2 py-0.5 rounded-md border text-[11px] font-bold shrink-0 ${actStyle.bg}`}>
                                              <ActIcon className="w-3 h-3" />
                                              <span className="font-mono">{act.action}</span>
                                            </span>

                                            <div className="min-w-0 flex-1">
                                              <p className="font-semibold text-slate-900 truncate">
                                                {act.description}
                                              </p>
                                              <div className="flex flex-wrap items-center gap-2 mt-0.5 text-[10px] text-slate-400 font-mono">
                                                <span>{act.path || '/dashboard'}</span>
                                                {act.details && Object.keys(act.details).length > 0 && (
                                                  <span className="text-slate-500 font-sans">
                                                    • {JSON.stringify(act.details)}
                                                  </span>
                                                )}
                                              </div>
                                            </div>
                                          </div>

                                          <div className="text-right shrink-0 pl-3">
                                            <span className="font-mono text-[11px] text-slate-600 font-semibold block">
                                              {actTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                            </span>
                                            <span className="text-[10px] text-slate-400 font-mono">
                                              {formatRelativeTime(act.timestamp)}
                                            </span>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <div className="px-6 py-4 bg-slate-50/70 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
            <div className="text-slate-500 font-medium">
              Showing page <span className="font-bold text-slate-900">{page}</span> of{' '}
              <span className="font-bold text-slate-900">{totalPages}</span> ({totalLogs} total sessions)
            </div>

            <div className="flex items-center space-x-3">
              {/* Page limit selector */}
              <div className="flex items-center space-x-1.5 text-slate-600">
                <span>Per page:</span>
                <select
                  value={limit}
                  onChange={(e) => {
                    setLimit(Number(e.target.value));
                    setPage(1);
                  }}
                  className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-semibold focus:outline-none cursor-pointer"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>

              {/* Prev / Next Buttons */}
              <div className="flex items-center space-x-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || loading}
                  className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  title="Previous page"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages || loading}
                  className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  title="Next page"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Inspect Single Session Forensic Modal */}
      {inspectLog && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-2xl w-full p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center font-bold">
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-black text-slate-900 text-sm">Session Forensic Audit Detail</h3>
                  <p className="text-[11px] text-slate-400 font-mono">
                    Session ID: {inspectLog.sessionId || inspectLog._id}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setInspectLog(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Actor / User</span>
                  <span className="font-bold text-slate-900">{inspectLog.userName || 'Unnamed'}</span>
                  <span className="text-[11px] text-slate-500 font-mono block">{inspectLog.userEmail}</span>
                  <span className="mt-1 inline-block">{getRoleBadge(inspectLog.userRole)}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Timestamp</span>
                  <span className="font-semibold text-slate-900">{formatExactTime(inspectLog.timestamp)}</span>
                  <span className="text-[11px] text-slate-500 block">({formatRelativeTime(inspectLog.timestamp)})</span>
                </div>
              </div>

              <div className="space-y-1.5 bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Action & Description</span>
                <div className="font-mono text-xs font-bold text-rose-600">{inspectLog.action}</div>
                <p className="text-slate-800 text-xs">{inspectLog.description}</p>
              </div>

              <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-100 font-mono text-[11px]">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block font-sans">Route / Path</span>
                  <span className="text-slate-800">{inspectLog.path || '/dashboard'}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block font-sans">Client IP</span>
                  <span className="text-slate-800">{inspectLog.ipAddress || '127.0.0.1'}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block font-sans">Device & Browser</span>
                  <span className="text-slate-800">{inspectLog.device || 'Desktop Web'}</span>
                </div>
              </div>

              {/* Complete Activities Trail inside this session */}
              {inspectLog.activities && inspectLog.activities.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block font-sans">
                      All Recorded Activities in this Login Session ({inspectLog.activities.length})
                    </span>
                    <span className="text-[10px] font-mono text-slate-500">
                      Started: {inspectLog.startedAt ? formatExactTime(inspectLog.startedAt) : '-'}
                    </span>
                  </div>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {inspectLog.activities.map((act, actIdx) => (
                      <div
                        key={act._id || actIdx}
                        className="p-2 rounded-lg bg-slate-50 border border-slate-200 text-xs flex items-start justify-between gap-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center space-x-1.5">
                            <span className="text-[10px] font-mono font-bold text-slate-400">
                              #{inspectLog.activities!.length - actIdx}
                            </span>
                            <span className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-700">
                              {act.action}
                            </span>
                            <span className="text-[10px] font-mono text-slate-400 truncate max-w-[150px]">
                              {act.path || '/dashboard'}
                            </span>
                          </div>
                          <p className="font-semibold text-slate-800 text-[11px] mt-0.5 truncate">
                            {act.description}
                          </p>
                        </div>
                        <span className="text-[10px] font-mono text-slate-400 shrink-0">
                          {formatExactTime(act.timestamp)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {inspectLog.details && Object.keys(inspectLog.details).length > 0 && (
                <div className="space-y-1 bg-slate-900 text-emerald-400 p-3.5 rounded-xl font-mono text-[11px] overflow-x-auto">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block font-sans mb-1">
                    Payload Metadata (JSON)
                  </span>
                  <pre>{JSON.stringify(inspectLog.details, null, 2)}</pre>
                </div>
              )}
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setInspectLog(null)}
                className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
