'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Navigation, useUserRole } from '@/components/Navigation';
import { UserProfileMenu } from '@/components/UserProfileMenu';
import * as XLSX from 'xlsx';
import { 
  Download, 
  ChevronDown, 
  User, 
  MessageSquare, 
  RefreshCw, 
  ArrowUpDown, 
  ArrowUp, 
  ArrowDown, 
  ArrowUpRight,
  ArrowDownLeft,
  PhoneOutgoing,
  PhoneIncoming,
  Clock,
  Calendar, 
  X,
  FileSpreadsheet,
  History,
  Radio,
  Headphones,
  Monitor,
  ExternalLink,
  ShieldCheck,
  Laptop
} from 'lucide-react';
import Link from 'next/link';

export default function RecorderHubDashboard() {
  const { role: userRole, email: userEmail, isSuperAdmin, isAdmin, isManager, isTeamLead: rawIsTeamLead, isCounselor: rawIsCounselor } = useUserRole();
  const [calls, setCalls] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState('All time');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [salesRepFilter, setSalesRepFilter] = useState('Teams');
  const [teamFilter, setTeamFilter] = useState('All Teams');
  const [counselorsList, setCounselorsList] = useState<any[]>([]);
  const [teamsList, setTeamsList] = useState<any[]>([]);
  const [recentActivities, setRecentActivities] = useState<any[]>([]);
  const [activeUsersCount, setActiveUsersCount] = useState<number>(0);
  const [dashboardOpensToday, setDashboardOpensToday] = useState<number>(0);
  const [expandedSessions, setExpandedSessions] = useState<Record<string, boolean>>({});

  type DashSortField = 'name' | 'total' | 'answered' | 'unanswered' | 'whatsapp' | 'duration' | 'uniqueCalls' | 'uniqueAnswered';
  const [dashSortField, setDashSortField] = useState<DashSortField>('total');
  const [dashSortOrder, setDashSortOrder] = useState<'asc' | 'desc'>('desc');

  const handleDashSort = (field: DashSortField) => {
    if (dashSortField === field) {
      setDashSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setDashSortField(field);
      setDashSortOrder(field === 'name' ? 'asc' : 'desc');
    }
  };

  const renderDashSortHeader = (field: DashSortField, label: string, extraClasses = '') => {
    const isActive = dashSortField === field;
    return (
      <th
        onClick={() => handleDashSort(field)}
        className={`p-4 font-bold text-center cursor-pointer select-none group hover:bg-slate-100/70 transition-colors ${extraClasses}`}
        title={`Sort by ${label} (${isActive ? (dashSortOrder === 'asc' ? 'Ascending' : 'Descending') : 'Click to sort'})`}
      >
        <div className="flex items-center justify-center space-x-1.5">
          <span>{label}</span>
          <span className="inline-flex items-center">
            {isActive ? (
              dashSortOrder === 'asc' ? (
                <ArrowUp className="w-3.5 h-3.5 text-brand-600 font-bold transition-transform duration-200" />
              ) : (
                <ArrowDown className="w-3.5 h-3.5 text-brand-600 font-bold transition-transform duration-200" />
              )
            ) : (
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-700 opacity-60 group-hover:opacity-100 transition-all duration-200" />
            )}
          </span>
        </div>
      </th>
    );
  };

  const isFetchingCallsRef = React.useRef(false);
  const isFetchingCounselorsRef = React.useRef(false);
  const isFetchingTeamsRef = React.useRef(false);
  const [summaryData, setSummaryData] = useState<any | null>(null);

  const fetchSummary = async () => {
    try {
      const params = new URLSearchParams();
      if (dateRange) params.set('dateRange', dateRange);
      if (customStartDate) params.set('startDate', customStartDate);
      if (customEndDate) params.set('endDate', customEndDate);
      if (salesRepFilter === 'Individual' || salesRepFilter === 'Counselors') {
        if (teamFilter && teamFilter !== 'All Counselors') {
          params.set('agentName', teamFilter);
          const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
          const target = norm(teamFilter);
          const matched = (counselorsList || []).find((c) => {
            const full = norm(`${c.firstName || ''} ${c.lastName || ''}`);
            const first = norm(c.firstName || '');
            const em = norm(c.email || '');
            return full === target || em === target || (first === target && !c.lastName);
          });
          if (matched?.email) {
            params.set('counselorEmail', matched.email);
          }
        }
      } else if (salesRepFilter === 'Teams') {
        if (teamFilter && teamFilter !== 'All Teams') {
          params.set('team', teamFilter);
        }
      }

      const res = await fetch(`/api/v1/dashboard/summary?${params.toString()}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setSummaryData(data);
      }
    } catch (err) {
      console.error('Error fetching dashboard summary:', err);
    }
  };

  const fetchCalls = async () => {
    if (isFetchingCallsRef.current) return;
    isFetchingCallsRef.current = true;
    try {
      if (calls.length === 0) setLoading(true);
      const res = await fetch('/api/v1/calls?limit=1000', {
        cache: 'no-store',
        headers: {
          Authorization: 'Bearer mock_jwt_token',
        },
      });
      if (res.ok) {
        const data = await res.json();
        const apiCalls = Array.isArray(data) ? data : data.calls || [];
        setCalls(apiCalls);
      }
    } catch (err) {
      console.error('Error fetching live dashboard calls:', err);
    } finally {
      setLoading(false);
      isFetchingCallsRef.current = false;
    }
  };

  const fetchCounselors = async () => {
    if (isFetchingCounselorsRef.current) return;
    isFetchingCounselorsRef.current = true;
    try {
      const res = await fetch('/api/v1/auth/counselors', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setCounselorsList(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Error fetching counselors list:', err);
    } finally {
      isFetchingCounselorsRef.current = false;
    }
  };

  const fetchTeams = async () => {
    if (isFetchingTeamsRef.current) return;
    isFetchingTeamsRef.current = true;
    try {
      const res = await fetch('/api/v1/teams', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setTeamsList(data);
        }
      }
    } catch (err) {
      console.error('Error fetching dashboard teams:', err);
    } finally {
      isFetchingTeamsRef.current = false;
    }
  };

  const fetchRecentActivities = async () => {
    if (!isAdmin && !isSuperAdmin) return;
    try {
      const res = await fetch('/api/v1/activity?limit=20&distinctUsers=true', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        const rawSessions: any[] = data.sessions || data.logs || [];
        // Deduplicate strictly by userEmail so that each user has EXACTLY 1 card
        const uniqueUserSessions: any[] = [];
        const seenEmails = new Set<string>();
        for (const s of rawSessions) {
          const em = (s.userEmail || '').toLowerCase().trim();
          if (em && !seenEmails.has(em)) {
            seenEmails.add(em);
            uniqueUserSessions.push(s);
          }
        }
        setRecentActivities(uniqueUserSessions);
        if (data.stats) {
          setActiveUsersCount(data.stats.uniqueUsersToday || uniqueUserSessions.length || 0);
          setDashboardOpensToday(data.stats.totalDashboardOpensToday || 0);
        }
      }
    } catch (err) {
      console.error('Error fetching recent activities for dashboard:', err);
    }
  };

  useEffect(() => {
    fetchSummary();
    fetchCalls();
    fetchCounselors();
    fetchTeams();
    fetchRecentActivities();
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && !document.hidden && document.visibilityState === 'visible') {
        fetchSummary();
        fetchCalls();
        fetchRecentActivities();
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [dateRange, customStartDate, customEndDate, salesRepFilter, teamFilter, isAdmin, isSuperAdmin]);

  const activeTeams = teamsList;

  const myManagedTeams = useMemo(() => {
    if (isSuperAdmin || isAdmin || isManager) return activeTeams;
    const myEmailLower = (userEmail || '').toLowerCase().trim();
    const myNamePrefix = myEmailLower ? myEmailLower.split('@')[0] : '';

    // Find current user profile from counselorsList if available
    const myUserObj = (counselorsList || []).find((c) => (c.email || '').toLowerCase().trim() === myEmailLower);
    const myFullName = myUserObj ? `${myUserObj.firstName || ''} ${myUserObj.lastName || ''}`.toLowerCase().trim() : '';
    const myFirstName = myUserObj?.firstName ? myUserObj.firstName.toLowerCase().trim() : '';
    const myUserId = myUserObj?._id ? (typeof myUserObj._id === 'string' ? myUserObj._id : myUserObj._id.toString()) : '';

    return activeTeams.filter((team) => {
      const adminStr = (team.admin || '').toLowerCase().trim();
      const teamLeadEmailStr = (team.teamLeadEmail || '').toLowerCase().trim();
      const teamLeadIdStr = (team.teamLeadId || '').toString().trim();
      const adminsArr = Array.isArray(team.admins) ? team.admins.map((a: string) => (a || '').toLowerCase().trim()) : [];

      // 1. Direct ID match
      if (myUserId && teamLeadIdStr && teamLeadIdStr === myUserId) return true;

      // 2. Direct Email match
      if (myEmailLower && teamLeadEmailStr && (teamLeadEmailStr === myEmailLower || myEmailLower.includes(teamLeadEmailStr))) return true;

      // 3. Admin name / alias matcher
      const isLeadMatch = (target: string) => {
        if (!target) return false;
        if (myEmailLower && (target === myEmailLower || target.includes(myEmailLower) || myEmailLower.includes(target))) return true;
        if (myFullName && (target === myFullName || target.includes(myFullName) || myFullName.includes(target))) return true;
        if (myFirstName && (target === myFirstName || target.includes(myFirstName) || myFirstName.includes(target))) return true;
        if (myNamePrefix && (target === myNamePrefix || target.includes(myNamePrefix) || myNamePrefix.includes(target))) return true;

        const targetWords = target.split(/\s+/).filter((w) => w.length >= 3);
        if (targetWords.some((w) => myNamePrefix.includes(w) || (myFirstName && myFirstName.includes(w)) || (myFullName && myFullName.includes(w)))) {
          return true;
        }
        return false;
      };

      if (isLeadMatch(adminStr)) return true;
      if (adminsArr.some((a) => isLeadMatch(a))) return true;

      return false;
    });
  }, [activeTeams, userEmail, isSuperAdmin, isAdmin, isManager, counselorsList]);

  const isTeamLead = !isSuperAdmin && !isAdmin && !isManager && (rawIsTeamLead || myManagedTeams.length > 0);
  const isCounselor = rawIsCounselor && myManagedTeams.length === 0 && !isAdmin && !isSuperAdmin && !isManager;

  const myTeamMemberIdentifiers = useMemo(() => {
    if (isSuperAdmin || isAdmin || isManager) return [];
    const memberSet = new Set<string>();
    const myEmailLower = (userEmail || '').toLowerCase().trim();
    const myNamePrefix = myEmailLower ? myEmailLower.split('@')[0] : '';

    if (myEmailLower) memberSet.add(myEmailLower);
    if (myNamePrefix) memberSet.add(myNamePrefix);

    const myUserObj = (counselorsList || []).find((c) => (c.email || '').toLowerCase().trim() === myEmailLower);
    if (myUserObj) {
      const full = `${myUserObj.firstName || ''} ${myUserObj.lastName || ''}`.toLowerCase().trim();
      if (full) memberSet.add(full);
      if (myUserObj.firstName) memberSet.add(myUserObj.firstName.toLowerCase().trim());
      if (myUserObj.lastName) memberSet.add(myUserObj.lastName.toLowerCase().trim());
    }

    myManagedTeams.forEach((team) => {
      if (Array.isArray(team.members)) {
        team.members.forEach((m: string) => {
          if (m) {
            const mClean = m.toLowerCase().trim();
            memberSet.add(mClean);

            // Cross-reference with counselorsList (all users in DB)
            const matchingCounselors = (counselorsList || []).filter((c) => {
              const cEmail = (c.email || '').toLowerCase().trim();
              const cFull = `${c.firstName || ''} ${c.lastName || ''}`.toLowerCase().trim();
              const cFirst = (c.firstName || '').toLowerCase().trim();
              const cPrefix = cEmail.split('@')[0];
              const cId = c._id ? c._id.toString() : '';
              return (
                cEmail === mClean ||
                cFull === mClean ||
                cFirst === mClean ||
                cPrefix === mClean ||
                cId === mClean
              );
            });

            matchingCounselors.forEach((mc) => {
              const mcEmail = (mc.email || '').toLowerCase().trim();
              if (mcEmail) {
                memberSet.add(mcEmail);
                memberSet.add(mcEmail.split('@')[0]);
              }
              const mcFull = `${mc.firstName || ''} ${mc.lastName || ''}`.toLowerCase().trim();
              if (mcFull) memberSet.add(mcFull);
              if (mc.firstName) memberSet.add(mc.firstName.toLowerCase().trim());
              if (mc.lastName) memberSet.add(mc.lastName.toLowerCase().trim());
              if (mc._id) memberSet.add(mc._id.toString());
            });
          }
        });
      }
    });

    return Array.from(memberSet);
  }, [myManagedTeams, userEmail, isSuperAdmin, isAdmin, isManager, counselorsList]);

  const resolveCounselorName = (c: any) => {
    if (!c) return 'Counselor Agent';

    // 1. Match by counselor email in counselorsList directory
    const callEmail = (c.counselorEmail || c.email || '').toLowerCase().trim();
    if (callEmail && counselorsList.length > 0) {
      const user = counselorsList.find((u) => (u.email || '').toLowerCase().trim() === callEmail);
      if (user) {
        const fullName = `${(user.firstName || '').trim()} ${(user.lastName || '').trim()}`.replace(/\s+/g, ' ').trim();
        if (fullName) return fullName;
      }
    }

    // 2. Exact match on agent name or alias
    if (counselorsList.length > 0) {
      const rawName = (c.agentName || c.counselorName || '').toLowerCase().replace(/\s+/g, ' ').trim();
      if (rawName && rawName !== 'counselor agent' && rawName !== 'counselor') {
        const user = counselorsList.find((u) => {
          const prefix = u.email ? u.email.split('@')[0].toLowerCase().trim() : '';
          const fName = (u.firstName || '').toLowerCase().trim();
          const fullName = `${(u.firstName || '').trim()} ${(u.lastName || '').trim()}`.toLowerCase().replace(/\s+/g, ' ').trim();
          if (fullName && rawName === fullName) return true;
          if (prefix && rawName === prefix) return true;
          if (fName && !u.lastName && rawName === fName) return true;
          return false;
        });
        if (user) {
          const fullName = `${(user.firstName || '').trim()} ${(user.lastName || '').trim()}`.replace(/\s+/g, ' ').trim();
          if (fullName) return fullName;
        }
      }
    }

    const email = c.counselorEmail || c.email;
    const derivedName = email ? email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()) : null;
    const rawAgentName = (c.agentName && c.agentName !== 'Sachin Negi' && c.agentName !== 'Counselor' && c.agentName !== 'Counselor Agent') ? c.agentName.replace(/\s+/g, ' ').trim() : null;
    const cleanDev = c.deviceId ? c.deviceId.replace(/^ANDROID-/, '').split('-')[0] : '';
    return rawAgentName || c.counselorName || derivedName || (cleanDev ? `Counselor (${cleanDev})` : 'Counselor Agent');
  };

  const canUserAccessCall = (call: any) => {
    if (isSuperAdmin || isAdmin || isManager) return true;

    const resolvedCounselor = resolveCounselorName(call).toLowerCase().trim();
    const callEmail = (call.counselorEmail || call.email || '').toLowerCase().trim();
    const myEmailLower = (userEmail || '').toLowerCase().trim();
    const myNamePrefix = myEmailLower ? myEmailLower.split('@')[0] : '';

    if (isTeamLead) {
      const myUserObj = (counselorsList || []).find((c) => (c.email || '').toLowerCase().trim() === myEmailLower);
      const myFullName = myUserObj ? `${myUserObj.firstName || ''} ${myUserObj.lastName || ''}`.trim().toLowerCase() : '';
      const myFirstName = myUserObj?.firstName ? myUserObj.firstName.toLowerCase().trim() : '';
      const myAgentName = (call.agentName || call.counselorName || '').toLowerCase().trim();

      const isMyOwn =
        (callEmail && callEmail === myEmailLower) ||
        (myFullName && resolvedCounselor === myFullName) ||
        (myFirstName && (resolvedCounselor === myFirstName || myAgentName === myFirstName)) ||
        (myNamePrefix && (resolvedCounselor === myNamePrefix || myAgentName === myNamePrefix));

      if (isMyOwn) return true;

      // Check direct team match
      const callTeamName = (call.team || call.teamName || call.department || '').toLowerCase().trim();
      if (callTeamName && myManagedTeams.some((t) => (t.name || '').toLowerCase().trim() === callTeamName)) {
        return true;
      }

      return myTeamMemberIdentifiers.some((identifier) => {
        if (!identifier || identifier.length < 2) return false;
        const idLower = identifier.toLowerCase().trim();
        return (
          resolvedCounselor === idLower ||
          (callEmail && (callEmail === idLower || callEmail.split('@')[0] === idLower)) ||
          (call.agentName && call.agentName.toLowerCase().trim() === idLower) ||
          (call.counselorName && call.counselorName.toLowerCase().trim() === idLower) ||
          (call.userId && call.userId.toString() === idLower)
        );
      });
    }

    if (isCounselor) {
      const myUserObj = (counselorsList || []).find((c) => (c.email || '').toLowerCase().trim() === myEmailLower);
      const myFullName = myUserObj ? `${myUserObj.firstName || ''} ${myUserObj.lastName || ''}`.trim().toLowerCase() : '';
      const myFirstName = myUserObj?.firstName ? myUserObj.firstName.toLowerCase().trim() : '';
      const myAgentName = (call.agentName || call.counselorName || '').toLowerCase().trim();

      const isMyOwn =
        (callEmail && callEmail === myEmailLower) ||
        (myFullName && resolvedCounselor === myFullName) ||
        (myFirstName && (resolvedCounselor === myFirstName || myAgentName === myFirstName)) ||
        (myNamePrefix && (resolvedCounselor === myNamePrefix || myAgentName === myNamePrefix));

      return Boolean(isMyOwn);
    }

    return true;
  };

  const uniqueCounselors = useMemo(() => {
    const names = new Set<string>();

    (counselorsList || []).forEach((c) => {
      const full = `${c.firstName || ''} ${c.lastName || ''}`.trim();
      if (full) {
        names.add(full);
      } else if (c.name) {
        names.add(c.name.trim());
      } else if (c.email) {
        const prefix = c.email.split('@')[0];
        names.add(prefix.replace(/[._]/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()));
      }
    });

    (calls || []).forEach((c) => {
      if (!c) return;
      const resolved = resolveCounselorName(c);
      if (resolved && resolved !== 'Counselor Agent' && resolved !== 'Counselor' && !resolved.startsWith('ANDROID-')) {
        names.add(resolved);
      }
    });

    return Array.from(names).filter(Boolean).sort((a, b) => a.localeCompare(b));
  }, [counselorsList, calls]);

  const displayedTeams = useMemo(() => {
    if (isSuperAdmin || isAdmin || isManager) {
      const userCreatedTeams = teamsList.map((t) => t.name).filter(Boolean);
      const callTeams = calls.map((c) => c.team || c.teamName || c.department).filter(Boolean);
      const counselorTeams = counselorsList.map((u) => u.team || u.teamName || u.department).filter(Boolean);
      const uniqueRealTeams = Array.from(new Set([...userCreatedTeams, ...callTeams, ...counselorTeams]));

      return uniqueRealTeams.filter(
        (name) =>
          name !== 'Global Sales' &&
          name !== 'NCLEX Counselors' &&
          name !== 'DHA Counselors' &&
          name !== 'Sales Team'
      );
    }

    if (isTeamLead && myManagedTeams.length > 0) {
      return myManagedTeams.map((t) => t.name).filter(Boolean);
    }
    if (isCounselor) {
      return [];
    }
    const userCreatedTeams = teamsList.map((t) => t.name).filter(Boolean);
    const callTeams = calls.map((c) => c.team || c.teamName || c.department).filter(Boolean);
    const counselorTeams = counselorsList.map((u) => u.team || u.teamName || u.department).filter(Boolean);
    const uniqueRealTeams = Array.from(new Set([...userCreatedTeams, ...callTeams, ...counselorTeams]));

    return uniqueRealTeams.filter(
      (name) =>
        name !== 'Global Sales' &&
        name !== 'NCLEX Counselors' &&
        name !== 'DHA Counselors' &&
        name !== 'Sales Team'
    );
  }, [isSuperAdmin, isAdmin, isManager, isTeamLead, isCounselor, myManagedTeams, teamsList, calls, counselorsList]);

  const displayedCounselors = useMemo(() => {
    if (isSuperAdmin || isAdmin || isManager) {
      return uniqueCounselors;
    }

    if (isTeamLead) {
      const allowedNames = new Set<string>();

      const myEmailLower = (userEmail || '').toLowerCase().trim();
      const myNamePrefix = myEmailLower ? myEmailLower.split('@')[0] : '';
      if (myEmailLower) allowedNames.add(myEmailLower);
      if (myNamePrefix) allowedNames.add(myNamePrefix);

      const myUserObj = (counselorsList || []).find((c) => (c.email || '').toLowerCase().trim() === myEmailLower);
      if (myUserObj) {
        const full = `${myUserObj.firstName || ''} ${myUserObj.lastName || ''}`.trim();
        if (full) allowedNames.add(full);
      }

      myManagedTeams.forEach((team) => {
        const teamNameLower = (team.name || '').toLowerCase().trim();

        (counselorsList || []).forEach((c) => {
          const cTeam = (c.team || c.teamName || c.department || '').toLowerCase().trim();
          const cEmail = (c.email || '').toLowerCase().trim();
          const cId = c._id ? String(c._id) : '';
          const cFull = `${c.firstName || ''} ${c.lastName || ''}`.trim();

          const isInTeamMembers = Array.isArray(team.members) && team.members.some((m: string) => {
            if (!m) return false;
            const mClean = m.toLowerCase().trim();
            return (
              mClean === cEmail ||
              mClean === cId ||
              (cFull && mClean === cFull.toLowerCase()) ||
              (c.firstName && mClean === c.firstName.toLowerCase()) ||
              mClean === cEmail.split('@')[0]
            );
          });

          if (isInTeamMembers || (teamNameLower && cTeam === teamNameLower)) {
            if (cFull) allowedNames.add(cFull);
            if (c.name) allowedNames.add(c.name.trim());
            if (c.email) allowedNames.add(c.email.split('@')[0]);
          }
        });

        if (Array.isArray(team.members)) {
          team.members.forEach((m: string) => {
            if (m && m.trim()) allowedNames.add(m.trim());
          });
        }
      });

      const filtered = uniqueCounselors.filter((c) => {
        const cLower = c.toLowerCase().trim();
        if (allowedNames.has(c)) return true;
        if (Array.from(allowedNames).some((a) => a.toLowerCase().trim() === cLower)) {
          return true;
        }
        return myTeamMemberIdentifiers.some((id) => id && id.toLowerCase().trim() === cLower);
      });

      return filtered.length > 0 ? filtered : uniqueCounselors;
    }

    if (isCounselor) {
      const myEmailLower = (userEmail || '').toLowerCase().trim();
      const myUserObj = (counselorsList || []).find((c) => (c.email || '').toLowerCase().trim() === myEmailLower);
      const myFullName = myUserObj ? `${myUserObj.firstName || ''} ${myUserObj.lastName || ''}`.trim().toLowerCase() : '';
      const myFirstName = myUserObj?.firstName ? myUserObj.firstName.toLowerCase().trim() : '';

      const matched = uniqueCounselors.filter((c) => {
        const cLower = c.toLowerCase().trim();
        return (
          cLower === myEmailLower ||
          (myFullName && cLower === myFullName) ||
          (myFirstName && cLower === myFirstName)
        );
      });
      return matched.length > 0 ? matched : [myFullName || myFirstName || (userEmail ? userEmail.split('@')[0] : 'My Calls')];
    }
    return uniqueCounselors;
  }, [isSuperAdmin, isAdmin, isManager, isTeamLead, isCounselor, uniqueCounselors, myManagedTeams, myTeamMemberIdentifiers, counselorsList, userEmail]);

  const handleCategoryChange = (val: string) => {
    setSalesRepFilter(val);
    if (val === 'Individual' || val === 'Counselors') {
      setTeamFilter('All Counselors');
    } else {
      setTeamFilter('All Teams');
    }
  };

  // Filter calls by Role Access, Date Range & Sales Rep / Team Selection
  const validCalls = (calls || []).filter((c) => {
    if (!c) return false;
    if (!canUserAccessCall(c)) return false;

    // Date Range Filter
    if (dateRange !== 'All time') {
      const callDate = c.startTime ? new Date(c.startTime) : new Date();
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

      if (dateRange === 'Today') {
        const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        if (callDate < startOfToday || callDate > endOfToday) return false;
      } else if (dateRange === 'Last 24 hours') {
        const last24h = new Date(now.getTime() - 24 * 3600 * 1000);
        if (callDate < last24h || callDate > now) return false;
      } else if (dateRange === 'Yesterday') {
        const startOfYesterday = new Date(startOfToday.getTime() - 86400000);
        const endOfYesterday = new Date(startOfToday.getTime() - 1);
        if (callDate < startOfYesterday || callDate > endOfYesterday) return false;
      } else if (dateRange === 'This week') {
        const sevenDaysAgo = new Date(startOfToday.getTime() - 7 * 86400000);
        if (callDate < sevenDaysAgo) return false;
      } else if (dateRange === 'This month') {
        const thirtyDaysAgo = new Date(startOfToday.getTime() - 30 * 86400000);
        if (callDate < thirtyDaysAgo) return false;
      } else if (dateRange === 'Custom') {
        if (customStartDate) {
          const [sYear, sMonth, sDay] = customStartDate.split('-').map(Number);
          const startCustom = new Date(sYear, sMonth - 1, sDay, 0, 0, 0, 0);
          if (callDate < startCustom) return false;
        }
        if (customEndDate) {
          const [eYear, eMonth, eDay] = customEndDate.split('-').map(Number);
          const endCustom = new Date(eYear, eMonth - 1, eDay, 23, 59, 59, 999);
          if (callDate > endCustom) return false;
        }
      }
    }

    // Sales Rep / Team Filter
    if (salesRepFilter === 'Individual' || salesRepFilter === 'Counselors') {
      if (teamFilter && teamFilter !== 'All Counselors') {
        const targetClean = teamFilter.replace(/\s+/g, ' ').trim().toLowerCase();
        const userClean = resolveCounselorName(c).replace(/\s+/g, ' ').trim().toLowerCase();
        const callEmail = (c.counselorEmail || c.email || '').toLowerCase().trim();
        const agentNameClean = (c.agentName || c.counselorName || '').replace(/\s+/g, ' ').trim().toLowerCase();

        const targetCounselor = (counselorsList || []).find((u) => {
          const fn = `${(u.firstName || '').trim()} ${(u.lastName || '').trim()}`.replace(/\s+/g, ' ').trim().toLowerCase();
          const f1 = (u.firstName || '').trim().toLowerCase();
          const em = (u.email || '').trim().toLowerCase();
          return fn === targetClean || em === targetClean || (f1 === targetClean && !u.lastName);
        });

        const targetEmail = targetCounselor?.email?.toLowerCase().trim();
        const targetFullName = targetCounselor ? `${(targetCounselor.firstName || '').trim()} ${(targetCounselor.lastName || '').trim()}`.replace(/\s+/g, ' ').trim().toLowerCase() : '';

        const matchesIndividual =
          userClean === targetClean ||
          (targetFullName && userClean === targetFullName) ||
          (targetEmail && callEmail && callEmail === targetEmail) ||
          (agentNameClean && (agentNameClean === targetClean || (targetFullName && agentNameClean === targetFullName)));

        if (!matchesIndividual) {
          return false;
        }
      }
    } else if (salesRepFilter === 'Teams') {
      if (teamFilter && teamFilter !== 'All Teams') {
        const targetLower = teamFilter.toLowerCase().trim();
        const callDirectTeam = (c.team || c.teamName || c.department || '').toLowerCase().trim();
        
        if (callDirectTeam && callDirectTeam === targetLower) {
          // Direct match
        } else {
          // Check if counselor/agent belongs to this team
          const teamObj = teamsList.find((t) => (t.name || '').toLowerCase().trim() === targetLower);
          const memberIdentifiers = new Set<string>();

          if (teamObj) {
            if (teamObj.teamLeadEmail) memberIdentifiers.add(teamObj.teamLeadEmail.toLowerCase().trim());
            if (teamObj.admin) {
              const adm = teamObj.admin.toLowerCase().trim();
              memberIdentifiers.add(adm);
              const admPrefix = adm.split('@')[0];
              if (admPrefix) memberIdentifiers.add(admPrefix);
            }
            if (Array.isArray(teamObj.admins)) {
              teamObj.admins.forEach((a: string) => {
                if (a) {
                  const aLower = a.toLowerCase().trim();
                  memberIdentifiers.add(aLower);
                  const aPrefix = aLower.split('@')[0];
                  if (aPrefix) memberIdentifiers.add(aPrefix);
                }
              });
            }
            if (Array.isArray(teamObj.members)) {
              teamObj.members.forEach((m: string) => {
                if (m) {
                  const mLower = m.toLowerCase().trim();
                  memberIdentifiers.add(mLower);

                  // Cross-reference with counselorsList
                  if (Array.isArray(counselorsList)) {
                    counselorsList.forEach((c) => {
                      const cEmail = (c.email || '').toLowerCase().trim();
                      const cFull = `${c.firstName || ''} ${c.lastName || ''}`.toLowerCase().trim();
                      const cFirst = (c.firstName || '').toLowerCase().trim();
                      const cPref = cEmail.split('@')[0];
                      const cId = c._id ? c._id.toString() : '';
                      if (
                        cEmail === mLower ||
                        cFull === mLower ||
                        cFirst === mLower ||
                        cPref === mLower ||
                        cId === mLower
                      ) {
                        if (cEmail) {
                          memberIdentifiers.add(cEmail);
                          memberIdentifiers.add(cPref);
                        }
                        if (cFull) memberIdentifiers.add(cFull);
                        if (c.firstName) memberIdentifiers.add(c.firstName.toLowerCase().trim());
                        if (c._id) memberIdentifiers.add(c._id.toString());
                      }
                    });
                  }
                }
              });
            }
          }

          if (Array.isArray(counselorsList)) {
            counselorsList.forEach((counselor: any) => {
              const cTeam = (counselor.team || counselor.teamName || counselor.department || '').toLowerCase().trim();
              if (cTeam === targetLower) {
                if (counselor.email) {
                  const emailLower = counselor.email.toLowerCase().trim();
                  memberIdentifiers.add(emailLower);
                  const emailPrefix = emailLower.split('@')[0];
                  if (emailPrefix) memberIdentifiers.add(emailPrefix);
                }
                const fullName = `${counselor.firstName || ''} ${counselor.lastName || ''}`.trim().toLowerCase();
                if (fullName) memberIdentifiers.add(fullName);
                if (counselor.firstName) memberIdentifiers.add(counselor.firstName.toLowerCase().trim());
                if (counselor._id) memberIdentifiers.add(counselor._id.toString());
                if (counselor.id) memberIdentifiers.add(counselor.id.toString());
              }
            });
          }

          const callEmail = (c.counselorEmail || c.email || '').toLowerCase().trim();
          const callAgent = (c.agentName || c.counselorName || c.userName || c.user || '').toLowerCase().trim();
          const resolved = resolveCounselorName(c).toLowerCase().trim();
          const callUserId = (c.userId || '').toString().toLowerCase().trim();

          const isDirectMember =
            (callEmail && memberIdentifiers.has(callEmail)) ||
            (callUserId && memberIdentifiers.has(callUserId)) ||
            (resolved && memberIdentifiers.has(resolved)) ||
            (callAgent && memberIdentifiers.has(callAgent));

          if (!isDirectMember) {
            return false;
          }
        }
      }
    }

    return true;
  });

  const totalCallsCount = summaryData ? summaryData.totalCalls : validCalls.length;
  const outboundCount = summaryData ? summaryData.outboundCalls : validCalls.filter((c) => (c?.direction || '').toUpperCase() === 'OUTGOING' || (c?.direction || '').toUpperCase() === 'OUTBOUND').length;
  const inboundCount = summaryData ? summaryData.inboundCalls : validCalls.filter((c) => (c?.direction || '').toUpperCase() === 'INCOMING' || (c?.direction || '').toUpperCase() === 'INBOUND').length;
  const answeredCount = summaryData ? summaryData.answeredCalls : validCalls.filter((c) => (c?.status || '').toUpperCase() === 'ANSWERED').length;

  const totalSeconds = summaryData ? summaryData.totalDuration : validCalls.reduce((sum, c) => {
    const isAns = (c?.status || 'ANSWERED').toUpperCase() === 'ANSWERED';
    return sum + (isAns ? (c?.durationSeconds || 0) : 0);
  }, 0);

  const outboundSeconds = summaryData ? summaryData.outboundDuration : validCalls.reduce((sum, c) => {
    const isAns = (c?.status || 'ANSWERED').toUpperCase() === 'ANSWERED';
    const isOut = (c?.direction || '').toUpperCase() === 'OUTGOING' || (c?.direction || '').toUpperCase() === 'OUTBOUND';
    return sum + (isAns && isOut ? (c?.durationSeconds || 0) : 0);
  }, 0);

  const inboundSeconds = summaryData ? summaryData.inboundDuration : validCalls.reduce((sum, c) => {
    const isAns = (c?.status || 'ANSWERED').toUpperCase() === 'ANSWERED';
    const isIn = (c?.direction || '').toUpperCase() === 'INCOMING' || (c?.direction || '').toUpperCase() === 'INBOUND';
    return sum + (isAns && isIn ? (c?.durationSeconds || 0) : 0);
  }, 0);

  const formatSecToHoursMins = (totalSec: number) => {
    const hours = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    if (hours > 0) return `${hours}h ${mins}m`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  };

  const avgSeconds = answeredCount > 0 ? Math.round(totalSeconds / answeredCount) : (validCalls.length > 0 ? Math.round(totalSeconds / validCalls.length) : 0);
  const avgDurationStr = `${Math.floor(avgSeconds / 60)}m ${avgSeconds % 60}s`;
  const totalTalkHours = Math.floor(totalSeconds / 3600);
  const totalTalkMins = Math.floor((totalSeconds % 3600) / 60);
  const totalTalkStr = `${totalTalkHours}h ${totalTalkMins}m`;
  const outboundTalkStr = formatSecToHoursMins(outboundSeconds);
  const inboundTalkStr = formatSecToHoursMins(inboundSeconds);

  // Hourly Call Breakdown (Most active hour by calls)
  const hourlyDistribution = React.useMemo(() => {
    const labels = [
      '12 am', '1 am', '2 am', '3 am', '4 am', '5 am', '6 am', '7 am', '8 am', '9 am', '10 am', '11 am',
      '12 pm', '1 pm', '2 pm', '3 pm', '4 pm', '5 pm', '6 pm', '7 pm', '8 pm', '9 pm', '10 pm', '11 pm'
    ];

    if (summaryData?.hourlyDistribution && Array.isArray(summaryData.hourlyDistribution)) {
      return summaryData.hourlyDistribution.map((h: any) => ({
        hourIndex: h.hourIndex,
        label: labels[h.hourIndex] || `${h.hourIndex}`,
        count: h.count || 0,
      }));
    }

    const hours = labels.map((label, idx) => ({ hourIndex: idx, label, count: 0 }));

    if (validCalls.length > 0) {
      const liveCounts = new Array(24).fill(0);
      let hasLiveTime = false;
      validCalls.forEach((call) => {
        if (call.startTime) {
          const d = new Date(call.startTime);
          const h = d.getHours();
          if (h >= 0 && h < 24) {
            liveCounts[h] += 1;
            hasLiveTime = true;
          }
        }
      });
      if (hasLiveTime) {
        hours.forEach((h) => {
          h.count = liveCounts[h.hourIndex];
        });
      }
    }

    return hours;
  }, [summaryData, validCalls]);

  const maxHourlyCount = Math.max(...hourlyDistribution.map((h) => h.count), 1);
  const peakHour = React.useMemo(() => {
    return [...hourlyDistribution].sort((a, b) => b.count - a.count)[0];
  }, [hourlyDistribution]);

  const formatReportDuration = (totalSec: number): string => {
    if (!totalSec || totalSec <= 0) return '0s';
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h:${m}m:${s}s`;
    return `${m}m:${s}s`;
  };

  const normalizePhoneNumber = (rawPhone: string): string => {
    if (!rawPhone) return '';
    const digits = rawPhone.replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
    if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
    if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
    return digits || rawPhone.trim().toLowerCase();
  };

  // Group calls by Counselor / Agent Name
  const userActivityMap: Record<string, {
    name: string;
    total: number;
    answered: number;
    unanswered: number;
    whatsapp: number;
    totalSeconds: number;
    uniquePhones: Set<string>;
    uniqueAnsweredPhones: Set<string>;
  }> = {};

  // 1. Initialize for all eligible displayed counselors so 0-call counselors are included in the report
  (displayedCounselors || []).forEach((cName) => {
    if (cName && cName !== 'All Counselors' && cName !== 'My Calls') {
      userActivityMap[cName] = {
        name: cName,
        total: 0,
        answered: 0,
        unanswered: 0,
        whatsapp: 0,
        totalSeconds: 0,
        uniquePhones: new Set<string>(),
        uniqueAnsweredPhones: new Set<string>(),
      };
    }
  });

  // 2. Map calls to the appropriate counselor record (using MongoDB server-side aggregation when available)
  if (summaryData?.byCounselor && Array.isArray(summaryData.byCounselor) && summaryData.byCounselor.length > 0) {
    summaryData.byCounselor.forEach((item: any) => {
      const email = (item.counselorEmail || item._id || '').toLowerCase().trim();
      const matchedCounselor = counselorsList.find((usr) => {
        if (email && usr.email && usr.email.toLowerCase().trim() === email) return true;
        return false;
      });
      const canonicalName = matchedCounselor
        ? `${matchedCounselor.firstName || ''} ${matchedCounselor.lastName || ''}`.trim() || matchedCounselor.name
        : item.agentName || (email ? email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()) : 'Counselor Agent');

      const resolvedName = canonicalName || 'Counselor Agent';
      let targetKey = resolvedName;
      const foundKey = Object.keys(userActivityMap).find((k) => k.toLowerCase().trim() === resolvedName.toLowerCase().trim());
      if (foundKey) {
        targetKey = foundKey;
      } else {
        userActivityMap[targetKey] = {
          name: targetKey,
          total: 0,
          answered: 0,
          unanswered: 0,
          whatsapp: 0,
          totalSeconds: 0,
          uniquePhones: new Set<string>(),
          uniqueAnsweredPhones: new Set<string>(),
        };
      }

      const entry = userActivityMap[targetKey];
      entry.total += (item.totalCalls || 0);
      entry.answered += (item.answeredCalls || 0);
      entry.unanswered += (item.unansweredCalls || 0);
      entry.whatsapp += (item.whatsappCalls || 0);
      entry.totalSeconds += (item.durationSeconds || 0);
    });
  } else {
    validCalls.forEach((c) => {
      if (!c) return;
      const email = c.counselorEmail || c.email;
      const callEmailLower = email ? email.toLowerCase().trim() : '';

      const matchedCounselor = counselorsList.find((usr) => {
        if (callEmailLower && usr.email && usr.email.toLowerCase().trim() === callEmailLower) return true;
        if (c.userId && usr._id && String(usr._id) === String(c.userId)) return true;
        return false;
      });

      const canonicalName = matchedCounselor
        ? `${matchedCounselor.firstName || ''} ${matchedCounselor.lastName || ''}`.trim() || matchedCounselor.name
        : null;

      const resolvedName = canonicalName || resolveCounselorName(c);

      let targetKey = resolvedName;
      if (!userActivityMap[targetKey]) {
        const foundKey = Object.keys(userActivityMap).find(
          (k) => k.toLowerCase().trim() === resolvedName.toLowerCase().trim()
        );
        if (foundKey) {
          targetKey = foundKey;
        } else {
          userActivityMap[targetKey] = {
            name: targetKey,
            total: 0,
            answered: 0,
            unanswered: 0,
            whatsapp: 0,
            totalSeconds: 0,
            uniquePhones: new Set<string>(),
            uniqueAnsweredPhones: new Set<string>(),
          };
        }
      }

      const entry = userActivityMap[targetKey];
      entry.total += 1;
      const isAnswered = (c.status || '').toUpperCase() === 'ANSWERED';
      if (isAnswered) {
        entry.answered += 1;
        entry.totalSeconds += (c.durationSeconds || 0);
      } else {
        entry.unanswered += 1;
      }

      const isWA = (c.channel || '').toUpperCase() === 'WHATSAPP' ||
                   (c.disposition || '').toLowerCase().includes('whatsapp') ||
                   (c.idempotencyKey || '').startsWith('WA_');
      if (isWA) {
        entry.whatsapp += 1;
      }

      const rawPhone = c.phoneNumber || c.phoneNumberMasked || c.leadId || '';
      const normPhone = normalizePhoneNumber(rawPhone);
      if (normPhone) {
        entry.uniquePhones.add(normPhone);
        if (isAnswered) {
          entry.uniqueAnsweredPhones.add(normPhone);
        }
      }
    });
  }

  const rawActivityRows = Object.values(userActivityMap).map((u) => {
    return {
      name: u.name,
      total: u.total,
      answered: u.answered,
      unanswered: u.unanswered,
      whatsapp: u.whatsapp,
      totalSeconds: u.totalSeconds,
      durationStr: formatReportDuration(u.totalSeconds),
      uniqueCalls: u.uniquePhones.size || (u.total > 0 ? u.total : 0),
      uniqueAnswered: u.uniqueAnsweredPhones.size || (u.answered > 0 ? u.answered : 0),
    };
  });

  const userActivityRows = rawActivityRows.sort((a, b) => {
    let cmp = 0;
    switch (dashSortField) {
      case 'name':
        cmp = a.name.localeCompare(b.name);
        break;
      case 'total':
        cmp = a.total - b.total;
        break;
      case 'answered':
        cmp = a.answered - b.answered;
        break;
      case 'unanswered':
        cmp = a.unanswered - b.unanswered;
        break;
      case 'whatsapp':
        cmp = a.whatsapp - b.whatsapp;
        break;
      case 'duration':
        cmp = a.totalSeconds - b.totalSeconds;
        break;
      case 'uniqueCalls':
        cmp = a.uniqueCalls - b.uniqueCalls;
        break;
      case 'uniqueAnswered':
        cmp = a.uniqueAnswered - b.uniqueAnswered;
        break;
    }
    return dashSortOrder === 'asc' ? cmp : -cmp;
  });

  const downloadExcelReport = () => {
    if (userActivityRows.length === 0) {
      alert('No counselor report data available to export.');
      return;
    }

    // Build worksheet data matching reference photo columns with WhatsApp Calls
    const worksheetData = [
      ['Name', 'Total', 'Answered', 'Unanswered', 'WhatsApp Calls', 'Duration', 'Unique Calls', 'Answered Calls'],
      ...userActivityRows.map((r) => [
        r.name,
        r.total,
        r.answered,
        r.unanswered,
        r.whatsapp,
        r.durationStr,
        r.uniqueCalls,
        r.uniqueAnswered,
      ]),
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

    // Set column widths for optimal display in Excel / Google Sheets
    worksheet['!cols'] = [
      { wch: 26 }, // Name
      { wch: 10 }, // Total
      { wch: 12 }, // Answered
      { wch: 14 }, // Unanswered
      { wch: 16 }, // WhatsApp Calls
      { wch: 16 }, // Duration
      { wch: 15 }, // Unique Calls
      { wch: 16 }, // Answered Calls
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Call Report');

    const dateStr = new Date().toISOString().split('T')[0];
    XLSX.writeFile(workbook, `RecorderHub_Call_Report_${dateStr}.xlsx`);

    try {
      import('@/lib/activity-tracker').then(({ trackClientActivity }) => {
        trackClientActivity({
          action: 'EXPORT_REPORT',
          actionCategory: 'EXPORTS',
          description: `Exported Call Analytics Report Excel (${userActivityRows.length} counselors, Date: ${dateRange}, Team: ${teamFilter})`,
          path: '/dashboard',
          details: {
            exportCount: userActivityRows.length,
            format: 'xlsx',
            dateRange,
            teamFilter,
            salesRepFilter,
          },
        });
      }).catch(() => {});
    } catch (e) {}
  };

  const exportCSV = () => {
    if (userActivityRows.length === 0) {
      alert('No counselor report data available to export.');
      return;
    }

    try {
      import('@/lib/activity-tracker').then(({ trackClientActivity }) => {
        trackClientActivity({
          action: 'EXPORT_REPORT',
          actionCategory: 'EXPORTS',
          description: `Exported Call Analytics Report CSV (${userActivityRows.length} counselors, Date: ${dateRange}, Team: ${teamFilter})`,
          path: '/dashboard',
          details: {
            exportCount: userActivityRows.length,
            format: 'csv',
            dateRange,
            teamFilter,
            salesRepFilter,
          },
        });
      }).catch(() => {});
    } catch (e) {}

    const headers = ['Name', 'Total', 'Answered', 'Unanswered', 'WhatsApp Calls', 'Duration', 'Unique Calls', 'Answered Calls'];
    const rows = userActivityRows.map((r) => [
      `"${(r.name || '').replace(/"/g, '""')}"`,
      r.total,
      r.answered,
      r.unanswered,
      r.whatsapp,
      `"${r.durationStr}"`,
      r.uniqueCalls,
      r.uniqueAnswered,
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    const dateStr = new Date().toISOString().split('T')[0];
    link.setAttribute('download', `RecorderHub_Call_Report_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-screen bg-[#f8fafc] text-slate-900 font-sans overflow-hidden">
      {/* Sidebar Navigation */}
      <Navigation />

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto p-8 relative">
        {/* Top Header Bar */}
        <header className="flex items-center justify-between pb-8">
          {/* Left Filters */}
          <div className="flex items-center space-x-6">
            <div>
              <label className="block text-xs font-bold text-slate-900 mb-1.5">Date range</label>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <select
                    value={dateRange}
                    onChange={(e) => setDateRange(e.target.value)}
                    className="appearance-none bg-white border border-slate-200 text-slate-800 text-sm font-medium rounded-lg px-4 py-2 pr-8 shadow-sm focus:outline-none focus:ring-2 focus:ring-rose-500/20 cursor-pointer"
                  >
                    <option value="This week">This week</option>
                    <option value="Today">Today</option>
                    <option value="Last 24 hours">Last 24 hours</option>
                    <option value="Yesterday">Yesterday</option>
                    <option value="This month">This month</option>
                    <option value="All time">All time</option>
                    <option value="Custom">Custom</option>
                  </select>
                  <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-3 pointer-events-none" />
                </div>

                {dateRange === 'Custom' && (
                  <div className="flex items-center space-x-2 bg-white border border-slate-200 px-3 py-1.5 rounded-lg shadow-sm animate-in fade-in duration-200">
                    <div className="flex items-center space-x-1.5 text-xs text-slate-600">
                      <span className="font-semibold text-slate-500">From:</span>
                      <input
                        type="date"
                        value={customStartDate}
                        onChange={(e) => setCustomStartDate(e.target.value)}
                        className="bg-slate-50 border border-slate-200 rounded px-2 py-1 text-xs text-slate-800 font-medium focus:outline-none focus:ring-1 focus:ring-rose-500 cursor-pointer"
                      />
                    </div>
                    <div className="flex items-center space-x-1.5 text-xs text-slate-600">
                      <span className="font-semibold text-slate-500">To:</span>
                      <input
                        type="date"
                        value={customEndDate}
                        onChange={(e) => setCustomEndDate(e.target.value)}
                        className="bg-slate-50 border border-slate-200 rounded px-2 py-1 text-xs text-slate-800 font-medium focus:outline-none focus:ring-1 focus:ring-rose-500 cursor-pointer"
                      />
                    </div>
                    {(customStartDate || customEndDate) && (
                      <button
                        onClick={() => {
                          setCustomStartDate('');
                          setCustomEndDate('');
                        }}
                        className="p-1 text-slate-400 hover:text-slate-600 rounded hover:bg-slate-100 transition-colors"
                        title="Clear custom dates"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-900 mb-1.5">Select sales reps</label>
              <div className="flex items-center space-x-3">
                <div className="relative">
                  <select
                    value={salesRepFilter}
                    onChange={(e) => handleCategoryChange(e.target.value)}
                    className="appearance-none bg-white border border-slate-200 text-slate-800 text-sm font-medium rounded-lg px-4 py-2 pr-8 shadow-sm focus:outline-none focus:ring-2 focus:ring-rose-500/20 cursor-pointer"
                  >
                    <option value="Teams">Teams</option>
                    <option value="Individual">Individual</option>
                  </select>
                  <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-3 pointer-events-none" />
                </div>

                <div className="relative">
                  <select
                    value={teamFilter}
                    onChange={(e) => setTeamFilter(e.target.value)}
                    className="appearance-none bg-white border border-slate-200 text-slate-800 text-sm font-medium rounded-lg px-4 py-2 pr-8 shadow-sm focus:outline-none focus:ring-2 focus:ring-rose-500/20 cursor-pointer"
                  >
                    {salesRepFilter === 'Individual' || salesRepFilter === 'Counselors' ? (
                      <>
                        <option value="All Counselors">All Counselors</option>
                        {displayedCounselors.map((counselor) => (
                          <option key={counselor} value={counselor}>
                            {counselor}
                          </option>
                        ))}
                      </>
                    ) : (
                      <>
                        <option value="All Teams">All Teams</option>
                        {displayedTeams.map((team) => (
                          <option key={team} value={team}>
                            {team}
                          </option>
                        ))}
                      </>
                    )}
                  </select>
                  <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-3 pointer-events-none" />
                </div>
              </div>
            </div>
          </div>

          {/* Right Action Icons & Excel / CSV Export */}
          <div className="flex items-center space-x-3">
            <button
              onClick={downloadExcelReport}
              className="flex items-center space-x-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-all shadow-sm shadow-emerald-600/20"
              title="Download call report as Excel (.xlsx) file"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Download Excel</span>
            </button>

            <button
              onClick={exportCSV}
              className="flex items-center space-x-2 bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 font-semibold px-3 py-2 rounded-lg text-sm transition-all shadow-sm"
              title="Export report in CSV format"
            >
              <Download className="w-4 h-4 text-slate-500" />
              <span>CSV</span>
            </button>

            <div className="flex items-center space-x-3 border-l border-slate-200 pl-3">
              <UserProfileMenu />
            </div>
          </div>
        </header>

        {/* Section 1: Overview Card */}
        <section className="mb-10">
          <h2 className="text-xl font-bold text-slate-900 mb-4 tracking-tight">
            {isTeamLead
              ? `Team Overview • ${myManagedTeams[0]?.name || 'My Team'}`
              : isCounselor
              ? 'Your Personal Call Activity Overview'
              : 'Get an overview of your call activity'}
          </h2>

          <div className="bg-white rounded-2xl border border-slate-200/80 p-10 shadow-sm">
            <div className="grid grid-cols-3 gap-8">
              {/* Total Calls */}
              <div>
                <span className="block text-5xl font-black text-slate-900 tracking-tight leading-none">
                  {totalCallsCount.toLocaleString()}
                </span>
                <span className="block text-base font-semibold text-slate-700 mt-2">Calls</span>
              </div>

              {/* Outbound Calls */}
              <div>
                <span className="block text-5xl font-black text-slate-900 tracking-tight leading-none">
                  {outboundCount.toLocaleString()}
                </span>
                <span className="block text-base font-semibold text-slate-700 mt-2">Outbound calls</span>
              </div>

              {/* Inbound Calls */}
              <div>
                <span className="block text-5xl font-black text-slate-900 tracking-tight leading-none">
                  {inboundCount.toLocaleString()}
                </span>
                <span className="block text-base font-semibold text-slate-700 mt-2">Inbound calls</span>
              </div>
            </div>
          </div>
        </section>

        {/* Admin Live User Activity & Dashboard Sessions Widget */}
        {(isAdmin || isSuperAdmin) && (
          <section className="mb-10">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <div className="flex items-center space-x-2.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                  <h2 className="text-xl font-bold text-slate-900 tracking-tight">
                    Live Team Activity & Dashboard Sessions
                  </h2>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                    Real-time Audit
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Live feed showing which team members opened the dashboard, when, and their recent actions.
                </p>
              </div>

              <div className="flex items-center space-x-3">
                <span className="text-xs font-semibold px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-lg border border-indigo-200/80">
                  {dashboardOpensToday} Dashboard Opens Today
                </span>
                <span className="text-xs font-semibold px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-lg border border-emerald-200/80">
                  {activeUsersCount} Active Users Today
                </span>
                <Link
                  href="/activity"
                  className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white shadow-sm transition-all"
                >
                  <History className="w-3.5 h-3.5" />
                  <span>View Full Activity Logs →</span>
                </Link>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm space-y-4">
              {recentActivities.length === 0 ? (
                <div className="py-6 text-center text-slate-400 space-y-2">
                  <Radio className="w-5 h-5 text-emerald-500 animate-pulse mx-auto" />
                  <p className="text-xs font-semibold text-slate-600">Session tracking active. Awaiting user logins and activity.</p>
                  <p className="text-[11px] text-slate-400">When users open the dashboard or perform actions, their session cards will appear here.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {recentActivities.slice(0, 6).map((session) => {
                    const latestAct = session.latestActivity || (session.activities && session.activities[0]) || {};
                    const isExpanded = Boolean(expandedSessions[session._id || session.sessionId]);
                    const sessionActs = session.activities || [];

                    const startedDate = new Date(session.startedAt || session.createdAt);
                    const lastActiveDate = new Date(session.lastActiveAt || session.updatedAt);
                    const diffMins = Math.max(0, Math.floor((Date.now() - lastActiveDate.getTime()) / 60000));
                    const timeAgo = diffMins < 1 ? 'Just now' : diffMins < 60 ? `${diffMins}m ago` : `${Math.floor(diffMins / 60)}h ago`;

                    const isOnline = session.isOnline !== undefined ? session.isOnline : (diffMins < 15);

                    const actAction = (latestAct.action || 'OPEN_DASHBOARD').toUpperCase();
                    const isDashOpen = actAction.includes('OPEN_DASHBOARD');
                    const isRec = actAction.includes('RECORDING');
                    const isExp = actAction.includes('EXPORT');
                    const isLogin = actAction.includes('LOGIN');

                    const badgeClass = isDashOpen
                      ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                      : isRec
                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : isExp
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : isLogin
                      ? 'bg-teal-50 text-teal-700 border-teal-200'
                      : 'bg-slate-100 text-slate-700 border-slate-200';

                    const ActionIcon = isDashOpen
                      ? Monitor
                      : isRec
                      ? Headphones
                      : isExp
                      ? FileSpreadsheet
                      : isLogin
                      ? ShieldCheck
                      : Clock;

                    return (
                      <div
                        key={session._id || session.sessionId}
                        className="p-4 rounded-xl border border-slate-200/90 bg-slate-50/70 hover:bg-slate-50 hover:border-slate-300 transition-all flex flex-col justify-between space-y-3"
                      >
                        {/* Session Card Header: 1 User = 1 Card */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center space-x-2.5 min-w-0">
                            {/* Avatar with live status dot */}
                            <div className="relative shrink-0">
                              <div className="w-8 h-8 rounded-full bg-slate-200 text-slate-800 font-bold flex items-center justify-center text-xs">
                                {(session.userName || session.userEmail).charAt(0).toUpperCase()}
                              </div>
                              <span
                                className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${
                                  isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
                                }`}
                                title={isOnline ? 'Active right now' : 'Idle / Offline'}
                              />
                            </div>

                            <div className="min-w-0">
                              <span className="text-xs font-bold text-slate-900 truncate block">
                                {session.userName || session.userEmail.split('@')[0]}
                              </span>
                              <span className="text-[10px] text-slate-400 font-mono truncate block">
                                {session.userEmail}
                              </span>
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                              isOnline
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-slate-100 text-slate-600 border-slate-200'
                            }`}>
                              {isOnline ? 'Online Now' : timeAgo}
                            </span>
                            <span className="block text-[10px] text-slate-400 mt-0.5">
                              {session.totalActions || sessionActs.length} {sessionActs.length === 1 ? 'action' : 'actions'}
                            </span>
                          </div>
                        </div>

                        {/* Session Meta */}
                        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500 bg-white/80 p-2 rounded-lg border border-slate-200/60 font-mono">
                          <span>
                            Started: {startedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span>•</span>
                          <span>Active for {session.durationMinutes || 1}m</span>
                          <span>•</span>
                          <span className="truncate max-w-[120px] font-sans">
                            {session.device || 'Desktop'}
                          </span>
                        </div>

                        {/* Latest Action In Session */}
                        <div className="space-y-1">
                          <div className="flex items-center space-x-1.5">
                            <span className={`inline-flex items-center space-x-1 text-[10px] font-bold px-2 py-0.5 rounded-md border ${badgeClass}`}>
                              <ActionIcon className="w-3 h-3" />
                              <span>{latestAct.action || 'OPEN_DASHBOARD'}</span>
                            </span>
                            <span className="text-[10px] font-mono text-slate-400 truncate">
                              {latestAct.path || session.currentPath || '/dashboard'}
                            </span>
                          </div>
                          <p className="text-xs font-semibold text-slate-800 line-clamp-1">
                            {latestAct.description || 'Active on dashboard'}
                          </p>
                        </div>

                        {/* Expandable Activity List for this Session */}
                        {sessionActs.length > 1 && (
                          <div className="pt-1 border-t border-slate-200/60 space-y-2">
                            <button
                              onClick={() => {
                                const sid = session._id || session.sessionId;
                                setExpandedSessions((prev) => ({ ...prev, [sid]: !prev[sid] }));
                              }}
                              className="text-[11px] font-bold text-slate-600 hover:text-slate-900 flex items-center justify-between w-full cursor-pointer py-0.5"
                            >
                              <span>
                                {isExpanded ? 'Hide session history' : `View all ${sessionActs.length} actions in this session`}
                              </span>
                              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                            </button>

                            {isExpanded && (
                              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1 animate-in fade-in">
                                {sessionActs.map((act: any, actIdx: number) => {
                                  const actTime = new Date(act.timestamp || Date.now());
                                  return (
                                    <div
                                      key={act._id || actIdx}
                                      className="flex items-start justify-between text-[10px] p-1.5 rounded bg-white border border-slate-100"
                                    >
                                      <div className="min-w-0 pr-2">
                                        <span className="font-bold text-slate-800 block truncate">
                                          {act.description || act.action}
                                        </span>
                                        <span className="font-mono text-slate-400 text-[9px]">
                                          {act.path || '/dashboard'}
                                        </span>
                                      </div>
                                      <span className="text-slate-400 font-mono shrink-0">
                                        {actTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        )}

        {/* Section 2: Analytics & Productivity */}
        <section className="mb-10">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Most active hour by calls Card (Exact layout & styling from user screenshot) */}
            <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200/80 p-8 shadow-sm flex flex-col justify-between">
              <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-100">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 tracking-tight">Most active hour by calls</h3>
                  <p className="text-xs text-slate-500 mt-0.5">24-hour call volume distribution</p>
                </div>
                {peakHour && peakHour.count > 0 && (
                  <span className="text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 px-3 py-1 rounded-full flex items-center space-x-1">
                    <span>🔥 Peak: <strong className="font-extrabold">{peakHour.label}</strong> ({peakHour.count} calls)</span>
                  </span>
                )}
              </div>

              {/* Scrollable 24-Hour Breakdown List */}
              <div className="overflow-y-auto max-h-[380px] pr-4 space-y-3.5 custom-scrollbar">
                {hourlyDistribution.map((item) => {
                  const percentage = (item.count / maxHourlyCount) * 100;
                  return (
                    <div key={item.hourIndex} className="flex items-center space-x-4 text-xs group">
                      <span className="w-16 text-right font-medium text-slate-600 select-none">
                        {item.label}
                      </span>
                      <div className="flex-1 flex items-center h-6 relative">
                        {item.count > 0 ? (
                          <div className="flex items-center space-x-2 w-full">
                            <div
                              style={{ width: `${Math.max(percentage, 4)}%` }}
                              className="h-5 bg-[#7c75db] hover:bg-[#6b64cb] rounded transition-all duration-300 flex items-center justify-end px-2 shadow-xs"
                            >
                              {percentage > 12 && (
                                <span className="text-[11px] font-bold text-white font-mono">{item.count}</span>
                              )}
                            </div>
                            {percentage <= 12 && (
                              <span className="text-[11px] font-bold text-slate-700 font-mono">{item.count}</span>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Productivity Card */}
            <div className="bg-white rounded-2xl border border-slate-200/80 p-8 shadow-sm flex flex-col justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900 tracking-tight mb-6">Improve your productivity</h3>
                <div className="space-y-6">
                  {/* Answered Calls */}
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                    <span className="block text-4xl font-black text-slate-900 tracking-tight leading-none">
                      {answeredCount.toLocaleString()}
                    </span>
                    <span className="block text-sm font-semibold text-slate-700 mt-2">Answered calls</span>
                  </div>

                  {/* Average Call Duration */}
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                    <span className="block text-4xl font-black text-slate-900 tracking-tight leading-none">
                      {avgDurationStr}
                    </span>
                    <span className="block text-sm font-semibold text-slate-700 mt-2">Average call duration</span>
                  </div>

                  {/* Total Talk Duration */}
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                    <span className="block text-4xl font-black text-slate-900 tracking-tight leading-none">
                      {totalTalkStr}
                    </span>
                    <span className="block text-sm font-semibold text-slate-700 mt-2">Total talk duration ({totalCallsCount} calls)</span>
                    <div className="mt-3 pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold">
                      <div className="flex items-center space-x-1.5 text-sky-700 bg-sky-50 px-2 py-1 rounded-lg border border-sky-100">
                        <PhoneOutgoing className="w-3.5 h-3.5" />
                        <span>Out: <strong className="text-sky-900">{outboundTalkStr}</strong> ({outboundCount})</span>
                      </div>
                      <div className="flex items-center space-x-1.5 text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg border border-emerald-100">
                        <PhoneIncoming className="w-3.5 h-3.5" />
                        <span>In: <strong className="text-emerald-900">{inboundTalkStr}</strong> ({inboundCount})</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Section 3: User Activity Table */}
        <section className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">User activity</h2>
            <div className="text-xs text-slate-500 font-medium">
              Showing {userActivityRows.length} counselors
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-800">
                <thead className="bg-white text-slate-900 font-extrabold border-b border-slate-200">
                  <tr>
                    {renderDashSortHeader('name', 'Name', 'pl-6 text-left')}
                    {renderDashSortHeader('total', 'Total')}
                    {renderDashSortHeader('answered', 'Answered')}
                    {renderDashSortHeader('unanswered', 'Unanswered')}
                    {renderDashSortHeader('whatsapp', 'WhatsApp Calls')}
                    {renderDashSortHeader('duration', 'Duration')}
                    {renderDashSortHeader('uniqueCalls', 'Unique Calls')}
                    {renderDashSortHeader('uniqueAnswered', 'Answered Calls', 'pr-6')}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {userActivityRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-12 text-center text-slate-500 font-medium">
                        {loading ? (
                          <div className="flex items-center justify-center space-x-2">
                            <RefreshCw className="w-4 h-4 animate-spin text-rose-500" />
                            <span>Loading user activity from mobile calls...</span>
                          </div>
                        ) : (
                          <span>No counselor call activity recorded yet. Sync calls from your mobile app to see live user activity!</span>
                        )}
                      </td>
                    </tr>
                  ) : (
                    userActivityRows.map((user, idx) => (
                      <tr key={idx} className="hover:bg-slate-50 transition-colors">
                        <td className="p-4 pl-6 font-semibold text-slate-900">{user.name}</td>
                        <td className="p-4 text-center text-slate-800 font-medium">{user.total}</td>
                        <td className="p-4 text-center text-slate-800 font-medium">{user.answered}</td>
                        <td className="p-4 text-center text-slate-800 font-medium">{user.unanswered}</td>
                        <td className="p-4 text-center text-emerald-600 font-semibold">{user.whatsapp}</td>
                        <td className="p-4 text-center font-mono text-slate-800">{user.durationStr}</td>
                        <td className="p-4 text-center text-slate-800 font-medium">{user.uniqueCalls}</td>
                        <td className="p-4 text-center text-slate-800 font-medium pr-6">{user.uniqueAnswered}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Floating Pink Chat Support Circle */}
        <div className="fixed bottom-6 right-6 z-40">
          <button className="w-12 h-12 rounded-full bg-rose-500 hover:bg-rose-600 text-white shadow-lg shadow-rose-500/30 flex items-center justify-center relative transition-transform hover:scale-105">
            <MessageSquare className="w-6 h-6 fill-white" />
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-white text-rose-600 font-bold text-[10px] flex items-center justify-center border border-rose-500">
              1
            </span>
          </button>
        </div>
      </main>
    </div>
  );
}
