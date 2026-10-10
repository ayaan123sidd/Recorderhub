'use client';

import React, { useState, useEffect, Suspense, useMemo, useRef } from 'react';
import { Navigation, useUserRole } from '@/components/Navigation';
import { UserProfileMenu } from '@/components/UserProfileMenu';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Search,
  ChevronDown,
  User,
  Download,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  PlayCircle,
  MessageSquare,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  ArrowUpRight,
  ArrowDownLeft,
  PhoneOutgoing,
  PhoneIncoming,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Calendar,
  X,
  AlertTriangle,
  AlertCircle,
  Mic,
  Clock,
  PhoneCall,
  Flame,
  Volume2,
  Star,
  Bookmark,
  Check,
  Play,
  Pause,
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  PhoneMissed
} from 'lucide-react';
import { useAudioPlayer } from '@/contexts/AudioPlayerContext';

const audioDurationCache = new Map<string, number>();

function getCallAudioDuration(call: any): number | null {
  if (typeof call.recordingDuration === 'number' && call.recordingDuration > 0) return call.recordingDuration;
  if (typeof call.audioDuration === 'number' && call.audioDuration > 0) return call.audioDuration;
  const audioSrc = call.audioUrl || (call.s3Key ? `/api/v1/recordings/stream?key=${encodeURIComponent(call.s3Key)}` : null);
  if (audioSrc && audioDurationCache.has(audioSrc)) {
    return audioDurationCache.get(audioSrc)!;
  }
  return null;
}

function isCallDurationMismatch(call: any): boolean {
  const isAns = (call.status || 'ANSWERED').toUpperCase() === 'ANSWERED';
  const callDur = isAns ? Number(call.durationSeconds || 0) : 0;
  // Unanswered / 0s calls do not have talk time and should never be marked as duration mismatches
  if (!isAns || callDur <= 0) return false;

  // Ignore calls where recording does NOT exist (only compare calls that actually have recordings)
  const hasRecording = (call.audioUrl || call.s3Key || call.recordingStatus === 'COMPLETED' || call.recordingStatus === 'PENDING_UPLOAD') && call.recordingStatus !== 'NONE';
  if (!hasRecording) return false;

  const recDur = getCallAudioDuration(call);

  if (recDur !== null && recDur > 0) {
    // 1. Severe stub/partial file: Call is >= 30s but recording is < 15s -> Mismatch
    if (callDur >= 30 && recDur < 15) return true;

    const diff = Math.abs(callDur - recDur);

    // 2. For short calls (< 30s), a difference >= 10s is a mismatch
    if (callDur < 30) {
      return diff >= 10;
    }

    // 3. For longer calls (>= 30s):
    // Standard VBR MP3 header estimations by browsers can vary by 5-10% (e.g. 8m 46s vs 9m 13s is a 95% match).
    // A true recording mismatch occurs when audio covers < 80% of call talk time AND difference >= 30s.
    const coverageRatio = recDur / callDur;
    if (coverageRatio < 0.80 && diff >= 30) {
      return true;
    }
  }
  return false;
}

function AudioCell({ call, idx, canListen = true }: { call: any; idx: number; canListen?: boolean }) {
  const { currentCall, isPlaying, playCall, duration: activePlayerDuration } = useAudioPlayer();

  const isAnswered = (call.status || 'ANSWERED').toUpperCase() === 'ANSWERED';
  const hasRecording = call.audioUrl || call.s3Key || call.recordingStatus === 'COMPLETED' || call.recordingStatus === 'PENDING_UPLOAD';

  if (!canListen) {
    return (
      <span className="inline-flex items-center space-x-1 text-slate-400 font-medium text-[11px] bg-slate-100 px-2 py-0.5 rounded border border-slate-200" title="Access Restricted: You can only listen to call recordings of counselors in your team.">
        <span>🔒</span>
        <span>Restricted</span>
      </span>
    );
  }

  if (!isAnswered || call.recordingStatus === 'NONE' || (!hasRecording && !call.audioUrl)) {
    return <span className="text-slate-400 font-medium text-[11px]">No Recording</span>;
  }

  const audioSrc = call.audioUrl || (call.s3Key ? `/api/v1/recordings/stream?key=${encodeURIComponent(call.s3Key)}` : null);

  if (!audioSrc) {
    if (call.recordingStatus === 'PENDING_UPLOAD') {
      return (
        <span className="inline-flex items-center space-x-1 text-amber-600 font-medium text-[11px] bg-amber-50 px-2 py-0.5 rounded border border-amber-200" title="Audio recording is syncing to AWS S3...">
          <span>⏳</span>
          <span>Syncing...</span>
        </span>
      );
    }
    return <span className="text-slate-400 font-medium text-[11px]">No Recording</span>;
  }

  const isThisCallActive = Boolean(currentCall && (
    (currentCall._id && currentCall._id === call._id) ||
    (currentCall.id && currentCall.id === call.id) ||
    (currentCall.idempotencyKey && currentCall.idempotencyKey === call.idempotencyKey) ||
    (currentCall.audioUrl && currentCall.audioUrl === call.audioUrl)
  ));

  const isThisCallPlaying = isThisCallActive && isPlaying;

  // Track actual audio file duration from active player or call record
  const [actualDuration, setActualDuration] = useState<number | null>(() => {
    if (call.recordingDuration && call.recordingDuration > 0) return call.recordingDuration;
    if (call.audioDuration && call.audioDuration > 0) return call.audioDuration;
    if (audioSrc && audioDurationCache.has(audioSrc)) {
      return audioDurationCache.get(audioSrc)!;
    }
    return call.durationSeconds || null;
  });

  // When active player is playing this call and reports duration, update cache and state
  useEffect(() => {
    if (isThisCallActive && activePlayerDuration > 0 && audioSrc) {
      const rounded = Math.round(activePlayerDuration);
      audioDurationCache.set(audioSrc, rounded);
      setActualDuration(rounded);
    }
  }, [isThisCallActive, activePlayerDuration, audioSrc]);

  const rawPhone = (call.phoneNumber || call.phoneNumberMasked || call.phone || '').trim();
  const safePhoneForFile = (rawPhone.replace(/[^a-zA-Z0-9_-]/g, '_') || 'Contact');
  const contactName = (call.leadName || call.name || safePhoneForFile).replace(/[^a-zA-Z0-9_-]/g, '_');
  const recordDate = call.startTime ? new Date(call.startTime) : new Date();
  const dateFormatted = recordDate.toISOString().slice(0, 10);
  const timeFormatted = recordDate.toTimeString().slice(0, 8).replace(/:/g, '-');
  const downloadFileName = `Recording_${contactName}_${safePhoneForFile}_${dateFormatted}_${timeFormatted}.m4a`;

  const timeDisplayStr = recordDate.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });

  const durationSec = actualDuration ?? (isThisCallActive && activePlayerDuration > 0 ? activePlayerDuration : (call.recordingDuration || call.audioDuration || call.durationSeconds || 0));

  const formatAudioDuration = (sec: number) => {
    const totalSec = Math.round(sec || 0);
    if (totalSec <= 0) return 'Play';
    const mins = Math.floor(totalSec / 60);
    const remainingSecs = totalSec % 60;

    if (mins === 0) {
      return `${remainingSecs}s`;
    }
    if (remainingSecs === 0) {
      return `${mins}m`;
    }
    return `${mins}m ${remainingSecs}s`;
  };

  const durationLabel = formatAudioDuration(durationSec);

  return (
    <div className="flex flex-col items-center justify-center py-0.5 space-y-1">
      <div className="flex items-center justify-center space-x-1.5">
        <button
          type="button"
          onClick={() => playCall(call)}
          title={isThisCallPlaying ? 'Pause recording (Space)' : 'Play recording (Hotkeys: Space, J/L to skip)'}
          className={`inline-flex items-center space-x-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all shadow-2xs ${
            isThisCallPlaying
              ? 'bg-rose-500 hover:bg-rose-600 text-white shadow-rose-500/20 ring-2 ring-rose-400/40'
              : isThisCallActive
                ? 'bg-rose-50 text-rose-600 border border-rose-300 hover:bg-rose-100'
                : 'bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-slate-700 border border-slate-200'
          }`}
        >
          {isThisCallPlaying ? (
            <>
              <Pause className="w-3.5 h-3.5 text-white fill-current" />
              <div className="flex items-end space-x-0.5 h-3">
                <span className="w-0.5 bg-white rounded-full animate-[bounce_0.6s_infinite] h-3" />
                <span className="w-0.5 bg-white rounded-full animate-[bounce_0.8s_infinite] h-2" />
                <span className="w-0.5 bg-white rounded-full animate-[bounce_0.5s_infinite] h-2.5" />
              </div>
              <span className="text-[11px] font-mono">Playing</span>
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 text-rose-600 fill-current" />
              <span className="text-[11px] font-mono">{durationLabel}</span>
            </>
          )}
        </button>

        <a
          href={audioSrc}
          download={downloadFileName}
          title={`Download audio file: ${downloadFileName}`}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 border border-slate-200 transition-colors shadow-2xs"
        >
          <Download className="w-3.5 h-3.5" />
        </a>
      </div>

      <div className="flex items-center space-x-1.5 text-[10px] text-slate-500 font-mono">
        <Clock className="w-2.5 h-2.5 text-slate-400" />
        <span>Rec: {timeDisplayStr}</span>
      </div>
    </div>
  );
}

function SalestrailCallsInner() {
  const { role, email: userEmail, isSuperAdmin, isAdmin, isManager, isTeamLead: rawIsTeamLead, isCounselor: rawIsCounselor } = useUserRole();
  const { currentCall, isPlayerVisible } = useAudioPlayer();
  const searchParams = useSearchParams();
  const isRecordingsOnly = searchParams.get('filter') === 'recordings';

  const [callsList, setCallsList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [callsToast, setCallsToast] = useState<{ message: string; type?: 'success' | 'error' } | null>(null);

  // Filters from Salestrail UI screenshot
  const [dateRange, setDateRange] = useState('All time');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [repCategory, setRepCategory] = useState('Teams');
  const [subFilter, setSubFilter] = useState('All Teams');
  const [searchQuery, setSearchQuery] = useState('');
  const [anomalyFilter, setAnomalyFilter] = useState<'all' | 'short_calls' | 'recordings' | 'sim' | 'whatsapp' | 'unanswered' | 'long_calls' | 'mismatch' | 'bookmarked'>('all');
  const [audioCacheVer, setAudioCacheVer] = useState(0);

  // Super Admin: Add & Edit Call Modals State
  const [isAddCallModalOpen, setIsAddCallModalOpen] = useState(false);
  const [isEditCallModalOpen, setIsEditCallModalOpen] = useState(false);
  const [callBeingEdited, setCallBeingEdited] = useState<any | null>(null);
  const [callFormAgent, setCallFormAgent] = useState('');
  const [callFormLead, setCallFormLead] = useState('');
  const [callFormPhone, setCallFormPhone] = useState('');
  const [callFormChannel, setCallFormChannel] = useState<'CELLULAR' | 'WHATSAPP'>('CELLULAR');
  const [callFormDirection, setCallFormDirection] = useState<'OUTGOING' | 'INCOMING'>('OUTGOING');
  const [callFormStatus, setCallFormStatus] = useState<'ANSWERED' | 'UNANSWERED' | 'MISSED' | 'REJECTED'>('ANSWERED');
  const [callFormDurationMin, setCallFormDurationMin] = useState('0');
  const [callFormDurationSec, setCallFormDurationSec] = useState('0');
  const [callFormStartTime, setCallFormStartTime] = useState('');
  const [callFormDisposition, setCallFormDisposition] = useState('');
  const [callFormNotes, setCallFormNotes] = useState('');
  const [callFormTeam, setCallFormTeam] = useState('');
  const [savingCallAction, setSavingCallAction] = useState(false);

  const getLocalDateTimeString = (d = new Date()) => {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const openAddCallModal = () => {
    const defaultAgent = counselorsList[0]?.firstName
      ? `${counselorsList[0].firstName} ${counselorsList[0].lastName || ''}`.trim()
      : 'Counselor Agent';
    setCallFormAgent(defaultAgent);
    setCallFormLead('');
    setCallFormPhone('+91 ');
    setCallFormChannel('CELLULAR');
    setCallFormDirection('OUTGOING');
    setCallFormStatus('ANSWERED');
    setCallFormDurationMin('2');
    setCallFormDurationSec('30');
    setCallFormStartTime(getLocalDateTimeString());
    setCallFormDisposition('Manual Call Record');
    setCallFormNotes('');
    setCallFormTeam('');
    setIsAddCallModalOpen(true);
  };

  const handleSaveNewCall = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSavingCallAction(true);
      const durSec = callFormStatus === 'ANSWERED'
        ? Number(callFormDurationMin || 0) * 60 + Number(callFormDurationSec || 0)
        : 0;

      const payload = {
        agentName: callFormAgent.trim(),
        leadName: callFormLead.trim() || callFormPhone.trim(),
        phoneNumber: callFormPhone.trim(),
        phoneNumberMasked: callFormPhone.trim(),
        channel: callFormChannel,
        direction: callFormDirection,
        status: callFormStatus,
        durationSeconds: durSec,
        startTime: callFormStartTime ? new Date(callFormStartTime).toISOString() : new Date().toISOString(),
        disposition: callFormDisposition.trim() || 'Manual Call Record',
        notes: callFormNotes.trim(),
        team: callFormTeam.trim(),
      };

      const res = await fetch('/api/v1/calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json();
        const created = data.call || payload;
        setCallsList((prev) => [created, ...prev]);
        setIsAddCallModalOpen(false);
        setCallsToast({ message: `Successfully added call log for ${payload.leadName || payload.phoneNumber}!`, type: 'success' });
        setTimeout(() => setCallsToast(null), 4000);
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(errData.message || 'Failed to add call record');
      }
    } catch (err) {
      console.error('Error creating manual call log:', err);
      alert('Error creating manual call log');
    } finally {
      setSavingCallAction(false);
    }
  };

  const openEditCallModal = (call: any) => {
    setCallBeingEdited(call);
    const durTotal = Number(call.durationSeconds || 0);
    const mins = Math.floor(durTotal / 60);
    const secs = durTotal % 60;
    const callDate = call.startTime ? new Date(call.startTime) : new Date();

    setCallFormAgent(resolveCounselorName(call));
    setCallFormLead(call.leadName || call.name || '');
    setCallFormPhone(call.phoneNumber || call.phoneNumberMasked || call.phone || '');
    setCallFormChannel((call.channel || '').toUpperCase() === 'WHATSAPP' ? 'WHATSAPP' : 'CELLULAR');
    setCallFormDirection((call.direction || '').toUpperCase() === 'INCOMING' ? 'INCOMING' : 'OUTGOING');
    setCallFormStatus((call.status || 'ANSWERED').toUpperCase() as any);
    setCallFormDurationMin(mins.toString());
    setCallFormDurationSec(secs.toString());
    setCallFormStartTime(getLocalDateTimeString(callDate));
    setCallFormDisposition(call.disposition || 'Manual Call Record');
    setCallFormNotes(call.notes || '');
    setCallFormTeam(call.team || call.teamName || '');
    setIsEditCallModalOpen(true);
  };

  const handleSaveEditCall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!callBeingEdited) return;

    try {
      setSavingCallAction(true);
      const callId = callBeingEdited._id || callBeingEdited.id || callBeingEdited.idempotencyKey;
      const durSec = callFormStatus === 'ANSWERED'
        ? Number(callFormDurationMin || 0) * 60 + Number(callFormDurationSec || 0)
        : 0;

      const payload: any = {
        id: callId,
        agentName: callFormAgent.trim(),
        leadName: callFormLead.trim(),
        phoneNumber: callFormPhone.trim(),
        channel: callFormChannel,
        direction: callFormDirection,
        status: callFormStatus,
        durationSeconds: durSec,
        startTime: callFormStartTime ? new Date(callFormStartTime).toISOString() : undefined,
        disposition: callFormDisposition.trim(),
        notes: callFormNotes.trim(),
        team: callFormTeam.trim(),
      };

      const res = await fetch(`/api/v1/calls?id=${encodeURIComponent(callId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setCallsList((prev) =>
          prev.map((c) =>
            (c._id === callId || c.id === callId || c.idempotencyKey === callId || String(c._id) === String(callId))
              ? { ...c, ...payload, phoneNumberMasked: payload.phoneNumber }
              : c
          )
        );
        setIsEditCallModalOpen(false);
        setCallBeingEdited(null);
        setCallsToast({ message: `Successfully updated call record and phone number!`, type: 'success' });
        setTimeout(() => setCallsToast(null), 4000);
        fetchCalls();
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(errData.message || 'Failed to update call log');
      }
    } catch (err) {
      console.error('Error updating call log:', err);
      alert('Error updating call log');
    } finally {
      setSavingCallAction(false);
    }
  };

  const handleDeleteCall = async (call: any) => {
    const callId = call._id || call.id || call.idempotencyKey;
    const phone = call.phoneNumber || call.phoneNumberMasked || call.phone || 'Contact';
    const agent = resolveCounselorName(call);

    if (!confirm(`Are you sure you want to permanently delete this call log (${phone} • ${agent})?\n\nThis will remove the record and any associated S3 audio file.`)) {
      return;
    }

    // Optimistic UI removal
    setCallsList((prev) => prev.filter((c) => c._id !== callId && c.id !== callId && c.idempotencyKey !== callId && String(c._id) !== String(callId)));
    setCallsToast({ message: `Deleted call log (${phone})`, type: 'success' });
    setTimeout(() => setCallsToast(null), 4000);

    try {
      await fetch(`/api/v1/calls?id=${encodeURIComponent(callId)}`, {
        method: 'DELETE',
      });
      fetchCalls();
    } catch (err) {
      console.error('Error deleting call log:', err);
    }
  };

  const [reviewingCall, setReviewingCall] = useState<any | null>(null);
  const [reviewRating, setReviewRating] = useState<number>(0);
  const [reviewNotes, setReviewNotes] = useState<string>('');
  const [reviewBookmark, setReviewBookmark] = useState<boolean>(false);
  const [savingReview, setSavingReview] = useState(false);

  const openReviewModal = (call: any) => {
    setReviewingCall(call);
    setReviewRating(Number(call.rating || 0));
    setReviewNotes(call.notes || '');
    setReviewBookmark(Boolean(call.isBookmarked));
  };

  const handleSaveReview = async () => {
    if (!reviewingCall) return;
    try {
      setSavingReview(true);
      const callId = reviewingCall._id || reviewingCall.id || reviewingCall.idempotencyKey;
      const res = await fetch('/api/v1/calls/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callId,
          rating: reviewRating,
          notes: reviewNotes,
          isBookmarked: reviewBookmark,
        }),
      });
      if (res.ok) {
        setCallsList((prev) =>
          prev.map((c) =>
            (c._id === callId || c.idempotencyKey === callId)
              ? { ...c, rating: reviewRating, notes: reviewNotes, isBookmarked: reviewBookmark }
              : c
          )
        );
        setReviewingCall(null);
      }
    } catch (e) {
      console.error('Error saving review:', e);
    } finally {
      setSavingReview(false);
    }
  };

  const handleRepCategoryChange = (cat: string) => {
    setRepCategory(cat);
    setCurrentPage(1);
    if (cat === 'Individual') {
      setSubFilter('All Counselors');
    } else {
      setSubFilter('All Teams');
    }
  };

  const [counselorsList, setCounselorsList] = useState<any[]>([]);
  const [assigningDeviceId, setAssigningDeviceId] = useState<string | null>(null);

  // Server-side pagination & aggregated statistics state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalRecords, setTotalRecords] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  type SortField = 'user' | 'phone' | 'name' | 'type' | 'startTime' | 'direction' | 'status' | 'duration' | 'audio';
  type SortOrder = 'asc' | 'desc';
  const [sortField, setSortField] = useState<SortField>('startTime');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  const [serverStats, setServerStats] = useState({
    totalCount: 0,
    totalDurSec: 0,
    totalTalkTimeStr: '0s',
    outboundCount: 0,
    outboundDurSec: 0,
    outboundTalkTimeStr: '0s',
    inboundCount: 0,
    inboundDurSec: 0,
    inboundTalkTimeStr: '0s',
    answeredCount: 0,
    unansweredCount: 0,
    simCount: 0,
    waCount: 0,
    mismatchCount: 0,
  });

  const isFetchingCounselorsRef = useRef(false);
  const isFetchingTeamsRef = useRef(false);
  const latestRequestIdRef = useRef(0);
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const allKnownCounselorsRef = useRef<Set<string>>(new Set());

  // Synchronously keep active filters up to date on every render to eliminate stale closures
  const filtersRef = useRef({
    dateRange,
    customStartDate,
    customEndDate,
    repCategory,
    subFilter,
    searchQuery,
    anomalyFilter,
    isRecordingsOnly,
    currentPage,
    pageSize,
    sortField,
    sortOrder,
  });

  // Always update synchronously in render body
  filtersRef.current = {
    dateRange,
    customStartDate,
    customEndDate,
    repCategory,
    subFilter,
    searchQuery,
    anomalyFilter,
    isRecordingsOnly,
    currentPage,
    pageSize,
    sortField,
    sortOrder,
  };

  const fetchCalls = async (
    targetPage?: number,
    targetPageSize?: number,
    targetSortField?: SortField,
    targetSortOrder?: SortOrder
  ) => {
    const currentFilters = filtersRef.current;
    const pageToFetch = targetPage ?? currentFilters.currentPage;
    const sizeToFetch = targetPageSize ?? currentFilters.pageSize;
    const fieldToFetch = targetSortField ?? currentFilters.sortField;
    const orderToFetch = targetSortOrder ?? currentFilters.sortOrder;

    const requestId = ++latestRequestIdRef.current;

    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    activeAbortControllerRef.current = abortController;

    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: pageToFetch.toString(),
        pageSize: sizeToFetch.toString(),
        dateRange: currentFilters.dateRange,
        sortField: fieldToFetch,
        sortOrder: orderToFetch,
      });

      if (currentFilters.anomalyFilter && currentFilters.anomalyFilter !== 'all') {
        params.set('anomaly', currentFilters.anomalyFilter);
      } else if (currentFilters.isRecordingsOnly) {
        params.set('anomaly', 'recordings');
      }

      if (currentFilters.dateRange === 'Custom') {
        if (currentFilters.customStartDate) params.set('startDate', currentFilters.customStartDate);
        if (currentFilters.customEndDate) params.set('endDate', currentFilters.customEndDate);
      }

      if (currentFilters.searchQuery.trim()) {
        params.set('search', currentFilters.searchQuery.trim());
      }

      if (currentFilters.repCategory === 'Individual' && currentFilters.subFilter !== 'All Counselors') {
        params.set('agentName', currentFilters.subFilter);
        const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const target = norm(currentFilters.subFilter);
        const matched = (counselorsList || []).find((c) => {
          const full = norm(`${c.firstName || ''} ${c.lastName || ''}`);
          const first = norm(c.firstName || '');
          const em = norm(c.email || '');
          return full === target || em === target || (first === target && !c.lastName);
        });
        if (matched?.email) {
          params.set('counselorEmail', matched.email);
        }
      } else if (currentFilters.repCategory === 'Teams' && currentFilters.subFilter !== 'All Teams') {
        params.set('team', currentFilters.subFilter);
      }

      const res = await fetch(`/api/v1/calls?${params.toString()}`, {
        cache: 'no-store',
        headers: {
          Authorization: 'Bearer mock_jwt_token',
        },
        signal: abortController.signal,
      });

      if (res.ok) {
        const data = await res.json();
        // Discard stale responses if a newer request was dispatched
        if (requestId !== latestRequestIdRef.current) return;

        if (data && data.calls) {
          setCallsList(data.calls || []);
          if (data.stats) {
            setServerStats(data.stats);
          }
          if (typeof data.totalRecords === 'number') {
            setTotalRecords(data.totalRecords);
          }
          if (typeof data.totalPages === 'number') {
            setTotalPages(data.totalPages);
          }
        } else if (Array.isArray(data)) {
          setCallsList(data);
          setTotalRecords(data.length);
          setTotalPages(Math.ceil(data.length / sizeToFetch) || 1);
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error('Error fetching live calls:', err);
    } finally {
      if (requestId === latestRequestIdRef.current) {
        setLoading(false);
      }
    }
  };

  const fetchProvisionedCounselors = async () => {
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

  useEffect(() => {
    fetchProvisionedCounselors();
    fetchTeams();

    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && !document.hidden && document.visibilityState === 'visible') {
        fetchCalls();
      }
    }, 60000);

    const handleGlobalPlay = (e: Event) => {
      const target = e.target as HTMLAudioElement;
      if (target && target.tagName === 'AUDIO') {
        const allAudios = document.querySelectorAll('audio');
        allAudios.forEach((audio) => {
          if (audio !== target && !audio.paused) {
            audio.pause();
          }
        });
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('play', handleGlobalPlay, true);
    }

    return () => {
      clearInterval(interval);
      if (typeof document !== 'undefined') {
        document.removeEventListener('play', handleGlobalPlay, true);
      }
    };
  }, []);

  const handleAssignCounselor = async (deviceId: string, newCounselorName: string) => {
    if (!deviceId || !newCounselorName) return;
    try {
      setAssigningDeviceId(deviceId);
      const res = await fetch('/api/v1/calls/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, agentName: newCounselorName }),
      });
      if (res.ok) {
        // Optimistically update local call list state for matching deviceId
        setCallsList((prevCalls) =>
          prevCalls.map((c) => (c.deviceId === deviceId ? { ...c, agentName: newCounselorName } : c))
        );
        fetchCalls();
      }
    } catch (err) {
      console.error('Error assigning counselor:', err);
    } finally {
      setAssigningDeviceId(null);
    }
  };

  const resolveCounselorName = (call: any) => {
    // 1. Match by counselor email in counselorsList directory
    const callEmail = (call.counselorEmail || call.email || '').toLowerCase().trim();
    if (callEmail && counselorsList.length > 0) {
      const user = counselorsList.find((u) => (u.email || '').toLowerCase().trim() === callEmail);
      if (user) {
        const fullName = `${(user.firstName || '').trim()} ${(user.lastName || '').trim()}`.replace(/\s+/g, ' ').trim();
        if (fullName) return fullName;
      }
    }

    // 2. Match device ID or agent name alias with directory email
    if (counselorsList.length > 0) {
      const rawName = (call.agentName || call.counselorName || '').toLowerCase().replace(/\s+/g, ' ').trim();
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

    const rawName = (call.agentName || call.counselorName || call.userName || call.user || '').replace(/\s+/g, ' ').trim();
    if (rawName && rawName !== 'Counselor Agent' && rawName !== 'Counselor' && !rawName.startsWith('ANDROID-')) {
      return rawName;
    }
    if (callEmail) {
      const prefix = callEmail.split('@')[0];
      return prefix.replace(/[._]/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());
    }
    if (call.deviceId) {
      const cleanDev = call.deviceId.replace(/^ANDROID-/, '');
      const modelTag = cleanDev.split('-')[0] || cleanDev.slice(0, 10);
      return `Counselor (${modelTag})`;
    }
    return 'Counselor Agent';
  };

  const [teamsList, setTeamsList] = useState<any[]>([]);

  const fetchTeams = async () => {
    try {
      const res = await fetch('/api/v1/teams', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setTeamsList(data);
        }
      }
    } catch (err) {
      console.error('Error fetching calls teams:', err);
    }
  };

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

        // Check word parts (e.g. "Zaid" in "Zaid Khan" vs "zaidk", "Surya" in "Surya" vs "suryas")
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
  }, [activeTeams, userEmail, isAdmin, isSuperAdmin, isManager, counselorsList]);

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
  }, [myManagedTeams, userEmail, isAdmin, isSuperAdmin, isManager, counselorsList]);

  const canUserAccessCall = (call: any) => {
    // 1. Super Admin & System Admin: Can view and listen to ALL call recordings across all teams
    if (isSuperAdmin || isAdmin) return { canView: true, canListen: true };

    // 2. Manager: Can view call logs and call log time of EVERY counsellor
    if (isManager) return { canView: true, canListen: true };

    const resolvedCounselor = resolveCounselorName(call).toLowerCase();
    const callEmail = (call.counselorEmail || call.email || '').toLowerCase();
    const myEmailLower = (userEmail || '').toLowerCase();
    const myNamePrefix = myEmailLower ? myEmailLower.split('@')[0] : '';

    // 3. Team Lead: Can view & listen to calls of counselors in their team(s) + own calls
    if (isTeamLead) {
      const myUserObj = (counselorsList || []).find((c) => (c.email || '').toLowerCase().trim() === myEmailLower);
      const myFullName = myUserObj ? `${myUserObj.firstName || ''} ${myUserObj.lastName || ''}`.trim().toLowerCase() : '';
      const myFirstName = myUserObj?.firstName ? myUserObj.firstName.toLowerCase().trim() : '';
      const myAgentName = (call.agentName || call.counselorName || '').toLowerCase().trim();

      const isMyOwnCall =
        (callEmail && callEmail === myEmailLower) ||
        (myFullName && resolvedCounselor === myFullName) ||
        (myFirstName && (resolvedCounselor === myFirstName || myAgentName === myFirstName)) ||
        (myNamePrefix && (resolvedCounselor === myNamePrefix || myAgentName === myNamePrefix));

      if (isMyOwnCall) return { canView: true, canListen: true };

      // Check if call's direct team matches any managed team
      const callTeamName = (call.team || call.teamName || call.department || '').toLowerCase().trim();
      if (callTeamName && myManagedTeams.some((t) => (t.name || '').toLowerCase().trim() === callTeamName)) {
        return { canView: true, canListen: true };
      }

      const isMemberInMyTeam = myTeamMemberIdentifiers.some((identifier) => {
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

      return { canView: isMemberInMyTeam, canListen: isMemberInMyTeam };
    }

    // 4. Sales User / Counselor: Can ONLY view & listen to their OWN calls
    if (isCounselor) {
      const myUserObj = (counselorsList || []).find((c) => (c.email || '').toLowerCase().trim() === myEmailLower);
      const myFullName = myUserObj ? `${myUserObj.firstName || ''} ${myUserObj.lastName || ''}`.trim().toLowerCase() : '';
      const myFirstName = myUserObj?.firstName ? myUserObj.firstName.toLowerCase().trim() : '';
      const myAgentName = (call.agentName || call.counselorName || '').toLowerCase().trim();

      const isMyOwnCall =
        (callEmail && callEmail === myEmailLower) ||
        (myFullName && resolvedCounselor === myFullName) ||
        (myFirstName && (resolvedCounselor === myFirstName || myAgentName === myFirstName)) ||
        (myNamePrefix && (resolvedCounselor === myNamePrefix || myAgentName === myNamePrefix));

      return { canView: Boolean(isMyOwnCall), canListen: Boolean(isMyOwnCall) };
    }

    return { canView: true, canListen: true };
  };

  // Get unique list of counselor names for dropdown
  const uniqueCounselors = useMemo(() => {
    const names = new Set<string>(allKnownCounselorsRef.current);

    // 1. From counselorsList (all provisioned users)
    (counselorsList || []).forEach((c) => {
      const full = `${(c.firstName || '').trim()} ${(c.lastName || '').trim()}`.replace(/\s+/g, ' ').trim();
      if (full) {
        names.add(full);
        allKnownCounselorsRef.current.add(full);
      } else if (c.name) {
        const cleaned = c.name.replace(/\s+/g, ' ').trim();
        names.add(cleaned);
        allKnownCounselorsRef.current.add(cleaned);
      } else if (c.email) {
        const prefix = c.email.split('@')[0];
        const formatted = prefix.replace(/[._]/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());
        names.add(formatted);
        allKnownCounselorsRef.current.add(formatted);
      }
    });

    // 2. From actual callsList
    (callsList || []).forEach((call) => {
      const resolved = resolveCounselorName(call);
      if (
        resolved &&
        resolved !== 'Counselor Agent' &&
        resolved !== 'Counselor' &&
        !resolved.startsWith('ANDROID-')
      ) {
        names.add(resolved);
        allKnownCounselorsRef.current.add(resolved);
      }
    });

    return Array.from(names).filter(Boolean).sort((a, b) => a.localeCompare(b));
  }, [counselorsList, callsList]);

  const displayedTeams = useMemo(() => {
    if (isSuperAdmin || isAdmin || isManager) {
      const userCreatedTeams = teamsList.map((t) => t.name).filter(Boolean);
      const callTeams = callsList.map((c) => c.team || c.teamName || c.department).filter(Boolean);
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
    const callTeams = callsList.map((c) => c.team || c.teamName || c.department).filter(Boolean);
    const counselorTeams = counselorsList.map((u) => u.team || u.teamName || u.department).filter(Boolean);
    const uniqueRealTeams = Array.from(new Set([...userCreatedTeams, ...callTeams, ...counselorTeams]));

    return uniqueRealTeams.filter(
      (name) =>
        name !== 'Global Sales' &&
        name !== 'NCLEX Counselors' &&
        name !== 'DHA Counselors' &&
        name !== 'Sales Team'
    );
  }, [isSuperAdmin, isAdmin, isManager, isTeamLead, isCounselor, myManagedTeams, teamsList, callsList, counselorsList]);

  const displayedCounselors = useMemo(() => {
    // 1. Super Admin / Admin / Manager see all counselors in the system
    if (isSuperAdmin || isAdmin || isManager) {
      return uniqueCounselors;
    }

    // 2. Team Lead: see counselors in their managed teams + self
    if (isTeamLead) {
      const allowedNames = new Set<string>();

      // Self
      const myEmailLower = (userEmail || '').toLowerCase().trim();
      const myNamePrefix = myEmailLower ? myEmailLower.split('@')[0] : '';
      if (myEmailLower) allowedNames.add(myEmailLower);
      if (myNamePrefix) allowedNames.add(myNamePrefix);

      const myUserObj = (counselorsList || []).find((c) => (c.email || '').toLowerCase().trim() === myEmailLower);
      if (myUserObj) {
        const full = `${myUserObj.firstName || ''} ${myUserObj.lastName || ''}`.trim();
        if (full) allowedNames.add(full);
      }

      // Add all members in managed teams
      myManagedTeams.forEach((team) => {
        const teamNameLower = (team.name || '').toLowerCase().trim();

        // Check counselorsList where user's team matches this team
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

    // 3. Counselor / Sales Agent: see only themselves
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

  // 2. Dynamic Summary Stats (Calculated server-side from entire MongoDB dataset of 17,800+ calls)
  const callStats = serverStats;

  // Final calls list to display on current page
  const paginatedCalls = callsList;

  // Trigger fast server-side query on filter or page changes (with search debouncing)
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchCalls(currentPage, pageSize, sortField, sortOrder);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery, dateRange, customStartDate, customEndDate, repCategory, subFilter, isRecordingsOnly, anomalyFilter, currentPage, pageSize]);

  const handleSort = (field: SortField) => {
    const newOrder = sortField === field ? (sortOrder === 'asc' ? 'desc' : 'asc') : (field === 'startTime' || field === 'duration' ? 'desc' : 'asc');
    setSortField(field);
    setSortOrder(newOrder);
    setCurrentPage(1);
    fetchCalls(1, pageSize, field, newOrder);
  };

  const renderSortHeader = (field: SortField, label: string, extraClasses = '') => {
    const isActive = sortField === field;
    return (
      <th
        onClick={() => handleSort(field)}
        className={`p-4 text-center font-bold whitespace-nowrap cursor-pointer select-none group hover:bg-slate-100/70 transition-colors ${extraClasses}`}
        title={`Sort by ${label} (${isActive ? (sortOrder === 'asc' ? 'Ascending' : 'Descending') : 'Click to sort'})`}
      >
        <div className="flex items-center justify-center space-x-1.5">
          <span>{label}</span>
          <span className="inline-flex items-center">
            {isActive ? (
              sortOrder === 'asc' ? (
                <ArrowUp className="w-3.5 h-3.5 text-brand-600 font-extrabold transition-transform duration-200" />
              ) : (
                <ArrowDown className="w-3.5 h-3.5 text-brand-600 font-extrabold transition-transform duration-200" />
              )
            ) : (
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-700 opacity-60 group-hover:opacity-100 transition-all duration-200" />
            )}
          </span>
        </div>
      </th>
    );
  };

  const exportCSV = async () => {
    try {
      const params = new URLSearchParams({
        export: 'true',
        dateRange,
        sortField,
        sortOrder,
      });

      if (anomalyFilter && anomalyFilter !== 'all') {
        params.set('anomaly', anomalyFilter);
      }

      if (dateRange === 'Custom') {
        if (customStartDate) params.set('startDate', customStartDate);
        if (customEndDate) params.set('endDate', customEndDate);
      }

      if (searchQuery.trim()) {
        params.set('search', searchQuery.trim());
      }

      if (repCategory === 'Individual' && subFilter !== 'All Counselors') {
        params.set('agentName', subFilter);
        const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const target = norm(subFilter);
        const matched = (counselorsList || []).find((c) => {
          const full = norm(`${c.firstName || ''} ${c.lastName || ''}`);
          const first = norm(c.firstName || '');
          const em = norm(c.email || '');
          return full === target || em === target || (first === target && !c.lastName);
        });
        if (matched?.email) {
          params.set('counselorEmail', matched.email);
        }
      } else if (repCategory === 'Teams' && subFilter !== 'All Teams') {
        params.set('team', subFilter);
      }

      const res = await fetch(`/api/v1/calls?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to export');
      const data = await res.json();
      const exportCalls = Array.isArray(data) ? data : data.calls || [];

      if (exportCalls.length === 0) {
        alert('No call records match the current filter selection to export.');
        return;
      }
      const headers = ['User', 'Phone Number', 'Name', 'Type', 'Call Time', 'Direction', 'Status', 'Duration'];
      const rows = exportCalls.map((c: any) => {
        const isAns = (c.status || 'ANSWERED').toUpperCase() === 'ANSWERED';
        const durSec = isAns ? Number(c.durationSeconds || 0) : 0;
        return [
          resolveCounselorName(c),
          c.phoneNumber || c.phoneNumberMasked || '',
          c.leadName || c.phoneNumber || '',
          c.channel === 'WHATSAPP' ? 'WhatsApp' : 'SIM',
          c.startTime ? new Date(c.startTime).toLocaleString() : '',
          c.direction || 'Outbound',
          isAns ? 'Answered' : 'Unanswered',
          durSec > 0 ? `${Math.floor(durSec / 60)}m:${durSec % 60}s` : '0s',
        ];
      });

      const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e: any) => e.join(','))].join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `RecorderHub_Calls_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      try {
        import('@/lib/activity-tracker').then(({ trackClientActivity }) => {
          trackClientActivity({
            action: 'EXPORT_CALLS',
            actionCategory: 'EXPORTS',
            description: `Exported ${exportCalls.length} call records to CSV (Date: ${dateRange}, Filter: ${subFilter})`,
            path: '/calls',
            details: {
              exportCount: exportCalls.length,
              dateRange,
              repCategory,
              subFilter,
              format: 'csv',
            },
          });
        }).catch(() => {});
      } catch (e) {}
    } catch (err) {
      console.error('Error exporting CSV:', err);
      alert('Error exporting CSV');
    }
  };

  return (
    <div className="flex h-screen bg-[#f8fafc] text-slate-900 font-sans overflow-hidden">
      {/* Sidebar Navigation */}
      <Navigation />

      {/* Main Content Area */}
      <main className={`flex-1 overflow-y-auto p-8 space-y-6 ${isPlayerVisible ? 'pb-36' : ''}`}>
        {/* Top Notification Toast */}
        {callsToast && (
          <div className={`p-4 rounded-xl flex items-center justify-between shadow-sm animate-in fade-in duration-200 border ${
            callsToast.type === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-700'
              : 'bg-emerald-50 border-emerald-200 text-emerald-700'
          }`}>
            <div className="flex items-center space-x-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              <span className="text-sm font-semibold">{callsToast.message}</span>
            </div>
            <button onClick={() => setCallsToast(null)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Header Right Bar: Profile Menu */}
        <div className="flex items-center justify-end">
          <UserProfileMenu />
        </div>

        {/* Top Filter Toolbar (Matching Salestrail Screenshot) */}
        <div className="flex flex-wrap items-center space-x-6 text-xs font-semibold text-slate-700 pb-2">
          {/* Date Range Dropdown */}
          <div className="space-y-1.5">
            <label className="block text-slate-900 font-bold text-sm">Date range</label>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <select
                  value={dateRange}
                  onChange={(e) => {
                    setDateRange(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="appearance-none bg-white border border-slate-200 text-slate-800 font-medium rounded-xl px-4 py-2.5 pr-8 shadow-sm focus:outline-none min-w-[140px] cursor-pointer hover:border-slate-300 transition-colors"
                >
                  <option value="This week">This week</option>
                  <option value="Today">Today</option>
                  <option value="Last 24 hours">Last 24 hours</option>
                  <option value="Yesterday">Yesterday</option>
                  <option value="This month">This month</option>
                  <option value="All time">All time</option>
                  <option value="Custom">Custom</option>
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-3.5 pointer-events-none" />
              </div>

              {dateRange === 'Custom' && (
                <div className="flex items-center space-x-2 bg-white border border-slate-200 px-3 py-1.5 rounded-xl shadow-sm animate-in fade-in duration-200">
                  <div className="flex items-center space-x-1.5 text-xs text-slate-600">
                    <span className="font-semibold text-slate-500">From:</span>
                    <input
                      type="date"
                      value={customStartDate}
                      onChange={(e) => {
                        setCustomStartDate(e.target.value);
                        setCurrentPage(1);
                      }}
                      className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-800 font-medium focus:outline-none focus:ring-1 focus:ring-brand-500 cursor-pointer"
                    />
                  </div>
                  <div className="flex items-center space-x-1.5 text-xs text-slate-600">
                    <span className="font-semibold text-slate-500">To:</span>
                    <input
                      type="date"
                      value={customEndDate}
                      onChange={(e) => {
                        setCustomEndDate(e.target.value);
                        setCurrentPage(1);
                      }}
                      className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-800 font-medium focus:outline-none focus:ring-1 focus:ring-brand-500 cursor-pointer"
                    />
                  </div>
                  {(customStartDate || customEndDate) && (
                    <button
                      onClick={() => {
                        setCustomStartDate('');
                        setCustomEndDate('');
                        setCurrentPage(1);
                      }}
                      className="p-1 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100 transition-colors cursor-pointer"
                      title="Clear custom dates"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Select Sales Reps Dropdown */}
          <div className="space-y-1.5">
            <label className="block text-slate-900 font-bold text-sm">Select sales reps</label>
            <div className="flex items-center space-x-2">
              <div className="relative">
                <select
                  value={repCategory}
                  onChange={(e) => handleRepCategoryChange(e.target.value)}
                  className="appearance-none bg-white border border-slate-200 text-slate-800 font-medium rounded-xl px-4 py-2.5 pr-8 shadow-sm focus:outline-none min-w-[140px] cursor-pointer hover:border-slate-300 transition-colors"
                >
                  <option value="Teams">Teams</option>
                  <option value="Individual">Individual</option>
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-3.5 pointer-events-none" />
              </div>

              <div className="relative">
                <select
                  value={subFilter}
                  onChange={(e) => {
                    setSubFilter(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="appearance-none bg-white border border-slate-200 text-slate-800 font-medium rounded-xl px-4 py-2.5 pr-8 shadow-sm focus:outline-none min-w-[160px] cursor-pointer hover:border-slate-300 transition-colors"
                >
                  {repCategory === 'Individual' ? (
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
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-3.5 pointer-events-none" />
              </div>
            </div>
          </div>

          <div className="flex-1 flex items-center justify-end pt-5 space-x-3">
            {isSuperAdmin && (
              <button
                onClick={openAddCallModal}
                className="flex items-center space-x-2 bg-[#242938] hover:bg-[#1a1e29] text-white font-bold px-4 py-2.5 rounded-xl text-xs shadow-md transition-all cursor-pointer"
                title="Super Admin: Manually Add Call Record"
              >
                <Plus className="w-4 h-4 text-white" />
                <span>+ Add Call Log</span>
              </button>
            )}

            <button
              onClick={exportCSV}
              className="flex items-center space-x-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold px-4 py-2.5 rounded-xl text-xs shadow-sm transition-all cursor-pointer"
            >
              <Download className="w-4 h-4 text-slate-500" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* Title & Search Bar */}
        <div className="flex items-center justify-between pt-2">
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
            {isRecordingsOnly ? 'Audio Recordings' : 'Calls'}
          </h1>

          {/* Search Box (Right Aligned) */}
          <div className="relative w-full max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            <input
              type="text"
              placeholder="Search name / number"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full bg-white border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-xs font-medium text-slate-800 placeholder-slate-400 shadow-sm focus:outline-none"
            />
          </div>
        </div>

        {/* Quick Anomaly & Performance Filter Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
            <button
              onClick={() => {
                setAnomalyFilter('all');
                setCurrentPage(1);
              }}
              className={`px-3 py-1.5 rounded-xl border transition-all cursor-pointer ${anomalyFilter === 'all'
                ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
            >
              All Calls ({callStats.totalCount})
            </button>

            <button
              onClick={() => {
                setAnomalyFilter('sim');
                setCurrentPage(1);
              }}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border transition-all cursor-pointer ${anomalyFilter === 'sim'
                ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                : 'bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100'
                }`}
            >
              <PhoneCall className="w-3.5 h-3.5" />
              <span>SIM Only ({callStats.simCount})</span>
            </button>

            <button
              onClick={() => {
                setAnomalyFilter('whatsapp');
                setCurrentPage(1);
              }}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border transition-all cursor-pointer ${anomalyFilter === 'whatsapp'
                ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                : 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>WhatsApp Logs ({callStats.waCount})</span>
            </button>

            <button
              onClick={() => {
                setAnomalyFilter('unanswered');
                setCurrentPage(1);
              }}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border transition-all cursor-pointer ${anomalyFilter === 'unanswered'
                ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                : 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                }`}
            >
              <PhoneMissed className="w-3.5 h-3.5" />
              <span>Unanswered Calls ({callStats.unansweredCount || 0})</span>
            </button>

            <button
              onClick={() => {
                setAnomalyFilter('mismatch');
                setCurrentPage(1);
              }}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border transition-all cursor-pointer ${anomalyFilter === 'mismatch'
                ? 'bg-red-600 text-white border-red-600 shadow-xs'
                : 'bg-red-50 text-red-800 border-red-200 hover:bg-red-100'
                }`}
              title="Calls where call talk duration and recording audio duration do not match (ignoring calls without recordings)"
            >
              <AlertCircle className="w-3.5 h-3.5" />
              <span>Duration Mismatch ({callStats.mismatchCount})</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-600">
            {/* Total Talk Time */}
            <span className="flex items-center space-x-1.5 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200" title="Total talk duration across all answered calls in selection">
              <Clock className="w-3.5 h-3.5 text-slate-600" />
              <span>
                Total Talk: <strong className="text-slate-900">{callStats.totalTalkTimeStr}</strong>{' '}
                <span className="text-slate-500 font-medium">({callStats.totalCount} calls)</span>
              </span>
            </span>

            {/* Outbound Talk Time & Count */}
            <span className="flex items-center space-x-1.5 bg-sky-50 px-3 py-1.5 rounded-xl border border-sky-200 text-sky-900" title="Total talk duration and call count for Outbound calls">
              <PhoneOutgoing className="w-3.5 h-3.5 text-sky-600" />
              <span>
                Outbound: <strong className="text-sky-950">{callStats.outboundTalkTimeStr}</strong>{' '}
                <span className="text-sky-700 font-medium">({callStats.outboundCount} calls)</span>
              </span>
            </span>

            {/* Inbound Talk Time & Count */}
            <span className="flex items-center space-x-1.5 bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-200 text-emerald-900" title="Total talk duration and call count for Inbound calls">
              <PhoneIncoming className="w-3.5 h-3.5 text-emerald-600" />
              <span>
                Inbound: <strong className="text-emerald-950">{callStats.inboundTalkTimeStr}</strong>{' '}
                <span className="text-emerald-700 font-medium">({callStats.inboundCount} calls)</span>
              </span>
            </span>
          </div>
        </div>

        {/* Calls Table (Matching Salestrail Order) */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm flex flex-col justify-between">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-800 whitespace-nowrap">
              <thead className="bg-white text-slate-900 font-extrabold border-b border-slate-200">
                <tr>
                  {renderSortHeader('user', 'User', 'pl-6')}
                  {renderSortHeader('phone', 'Phone Number')}
                  {renderSortHeader('name', 'Name')}
                  {renderSortHeader('type', 'Type')}
                  {renderSortHeader('startTime', 'Call Time')}
                  {renderSortHeader('direction', 'Direction')}
                  {renderSortHeader('status', 'Status')}
                  {renderSortHeader('duration', 'Duration')}
                  {renderSortHeader('audio', 'Audio Recording', isSuperAdmin ? '' : 'pr-6')}
                  {isSuperAdmin && (
                    <th className="p-4 pr-6 text-center font-bold whitespace-nowrap">
                      Actions
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {paginatedCalls.length === 0 ? (
                  <tr>
                    <td colSpan={isSuperAdmin ? 10 : 9} className="p-12 text-center text-slate-500 font-medium">
                      {loading ? (
                        <div className="flex items-center justify-center space-x-2">
                          <RefreshCw className="w-4 h-4 animate-spin text-rose-500" />
                          <span>Syncing live call records from mobile...</span>
                        </div>
                      ) : (
                        <span>No {isRecordingsOnly ? 'recordings' : 'calls'} found matching filter. Make a call on your Android phone to log calls live!</span>
                      )}
                    </td>
                  </tr>
                ) : (
                  paginatedCalls.map((call, idx) => {
                    const isWhatsApp =
                      (call.channel || '').toUpperCase() === 'WHATSAPP' ||
                      (call.disposition || '').toLowerCase().includes('whatsapp') ||
                      (call.idempotencyKey || '').startsWith('WA_');

                    const rawPhoneInput = (call.phoneNumber || call.phoneNumberMasked || call.phone || '').trim();
                    const rawLeadName = (call.leadName || call.name || '').trim();

                    let cleanPhone = rawPhoneInput;
                    if (isWhatsApp) {
                      // WhatsApp Calls: Do NOT automatically add +91. Print the exact phone number captured.
                      cleanPhone = rawPhoneInput || rawLeadName || 'WhatsApp Contact';
                    } else {
                      // SIM Calls: preserve international prefix if present, or format 10-digit Indian numbers
                      if (rawPhoneInput.startsWith('+')) {
                        cleanPhone = rawPhoneInput;
                      } else {
                        const digitsOnly = rawPhoneInput.replace(/\D/g, '');
                        if (digitsOnly.length === 10) {
                          cleanPhone = `+91 ${digitsOnly.slice(0, 5)} ${digitsOnly.slice(5)}`;
                        } else if (digitsOnly.startsWith('0') && digitsOnly.length === 11) {
                          const c10 = digitsOnly.slice(1);
                          cleanPhone = `+91 ${c10.slice(0, 5)} ${c10.slice(5)}`;
                        } else if (digitsOnly.length > 10) {
                          cleanPhone = `+${digitsOnly}`;
                        } else {
                          cleanPhone = rawPhoneInput || 'Contact';
                        }
                      }
                    }

                    const contactName = rawLeadName || cleanPhone;
                    const startTimeStr = call.startTime ? new Date(call.startTime).toLocaleString('en-US', {
                      month: '2-digit',
                      day: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                      hour12: false
                    }) : '08/08/2026 23:15:56';

                    const isAnswered = (call.status || 'ANSWERED').toUpperCase() === 'ANSWERED';
                    const effectiveDuration = isAnswered ? Number(call.durationSeconds || 0) : 0;
                    const durationMins = effectiveDuration > 0 ? Math.floor(effectiveDuration / 60) : 0;
                    const durationSecs = effectiveDuration > 0 ? effectiveDuration % 60 : 0;
                    const durationStr = isAnswered && effectiveDuration > 0
                      ? (durationMins > 0 ? (durationSecs > 0 ? `${durationMins}m ${durationSecs}s` : `${durationMins}m`) : `${durationSecs}s`)
                      : '0s';

                    const isOutbound = (call.direction || 'OUTGOING').toUpperCase() === 'OUTGOING' || (call.direction || '').toUpperCase() === 'OUTBOUND';

                    const isMismatchRow = isCallDurationMismatch(call);

                    const isThisRowActive = Boolean(currentCall && (
                      (currentCall._id && currentCall._id === call._id) ||
                      (currentCall.id && currentCall.id === call.id) ||
                      (currentCall.idempotencyKey && currentCall.idempotencyKey === call.idempotencyKey) ||
                      (currentCall.audioUrl && currentCall.audioUrl === call.audioUrl)
                    ));

                    return (
                      <tr 
                        key={call.id || call._id || idx} 
                        className={`transition-colors ${
                          isThisRowActive 
                            ? 'bg-rose-50/70 border-l-4 border-rose-500' 
                            : 'hover:bg-slate-50'
                        }`}
                      >
                        {/* User */}
                        <td className="p-4 pl-6 font-semibold text-slate-900 text-center whitespace-nowrap">
                          {resolveCounselorName(call)}
                        </td>
                        {/* Phone Number */}
                        <td className="p-4 text-center font-mono font-medium text-slate-900 whitespace-nowrap">
                          {cleanPhone}
                        </td>
                        {/* Name */}
                        <td className="p-4 text-center font-medium text-slate-800 whitespace-nowrap">
                          {contactName}
                        </td>
                        {/* Type */}
                        <td className="p-4 text-center whitespace-nowrap">
                          <span className={`inline-block px-2.5 py-1 rounded-md text-[11px] font-semibold ${isWhatsApp ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-800'
                            }`}>
                            {isWhatsApp ? 'WhatsApp' : 'SIM'}
                          </span>
                        </td>
                        {/* Call Time */}
                        <td className="p-4 text-center font-mono text-slate-700 text-[11px] whitespace-nowrap">
                          {startTimeStr}
                        </td>
                        {/* Direction */}
                        <td className="p-4 text-center font-medium text-slate-800 whitespace-nowrap">
                          {isOutbound ? 'Outbound' : 'Inbound'}
                        </td>
                        {/* Status */}
                        <td className="p-4 text-center font-medium text-slate-800 whitespace-nowrap">
                          {isAnswered ? 'Answered' : 'Unanswered'}
                        </td>
                        {/* Duration */}
                        <td className="p-4 text-center font-semibold text-slate-900 whitespace-nowrap">
                          {isAnswered && effectiveDuration > 0 && effectiveDuration < 15 ? (
                            <div className="flex items-center justify-center space-x-1.5 whitespace-nowrap">
                              <span className="text-amber-800 font-bold">{durationStr}</span>
                              <span
                                className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-amber-100 text-amber-800 border border-amber-300 shadow-2xs"
                                title="Suspicious short call (< 15s) - click audio to audit pitch"
                              >
                                ⚠️ Short
                              </span>
                            </div>
                          ) : isMismatchRow ? (
                            <div className="flex items-center justify-center space-x-1.5 whitespace-nowrap">
                              <span className="text-red-700 font-bold">{durationStr}</span>
                              <span
                                className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-red-100 text-red-800 border border-red-300 shadow-2xs"
                                title="Duration mismatch: Call talk time and audio recording length do not match"
                              >
                                ⚠️ Mismatch
                              </span>
                            </div>
                          ) : (
                            <span className="whitespace-nowrap">{durationStr}</span>
                          )}
                        </td>

                        {/* Audio Recording */}
                        <td className={`p-4 text-center whitespace-nowrap ${isSuperAdmin ? '' : 'pr-6'}`}>
                          <AudioCell call={call} idx={idx} canListen={canUserAccessCall(call).canListen} />
                        </td>

                        {/* Super Admin Actions */}
                        {isSuperAdmin && (
                          <td className="p-4 pr-6 text-center whitespace-nowrap">
                            <div className="flex items-center justify-center space-x-1.5">
                              <button
                                onClick={() => openEditCallModal(call)}
                                title="Super Admin: Edit Call Details & Phone Number"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 border border-transparent hover:border-slate-200 transition-all cursor-pointer"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteCall(call)}
                                title="Super Admin: Delete Call Record & Audio"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 transition-all cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-medium text-slate-700">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <span className="text-slate-500">Rows per page:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="bg-white border border-slate-200 text-slate-800 font-semibold rounded-lg px-2.5 py-1 focus:outline-none shadow-xs cursor-pointer"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>

              <span className="text-slate-500 font-medium">
                Showing <strong className="text-slate-900">{totalRecords > 0 ? (currentPage - 1) * pageSize + 1 : 0}</strong> to{' '}
                <strong className="text-slate-900">{Math.min(currentPage * pageSize, totalRecords)}</strong> of{' '}
                <strong className="text-slate-900">{totalRecords}</strong> {isRecordingsOnly ? 'recordings' : 'calls'}
              </span>
            </div>

            <div className="flex items-center space-x-1.5">
              <button
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                title="First Page"
              >
                <ChevronsLeft className="w-4 h-4" />
              </button>

              <button
                onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                title="Previous Page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <div className="flex items-center space-x-1 px-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((pg) => pg === 1 || pg === totalPages || Math.abs(pg - currentPage) <= 1)
                  .map((pg, i, arr) => {
                    const prevPg = arr[i - 1];
                    const showEllipsis = prevPg && pg - prevPg > 1;
                    return (
                      <React.Fragment key={pg}>
                        {showEllipsis && <span className="px-1 text-slate-400 font-bold">...</span>}
                        <button
                          onClick={() => setCurrentPage(pg)}
                          className={`min-w-[32px] h-8 px-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                            currentPage === pg
                              ? 'bg-rose-500 text-white shadow-sm shadow-rose-500/20'
                              : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          {pg}
                        </button>
                      </React.Fragment>
                    );
                  })}
              </div>

              <button
                onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages || totalPages === 0}
                className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                title="Next Page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              <button
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages || totalPages === 0}
                className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                title="Last Page"
              >
                <ChevronsRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Call Quality Coaching & Review Modal */}
        {reviewingCall && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
            <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-slate-200 space-y-4 animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900">Call Quality Coaching & Review</h3>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">
                    {resolveCounselorName(reviewingCall)} • {reviewingCall.phoneNumber}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setReviewingCall(null)}
                  className="text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3">
                {/* Star Rating */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Sales Pitch Quality Rating</label>
                  <div className="flex items-center space-x-1.5">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setReviewRating(star)}
                        className={`text-2xl transition-transform hover:scale-110 cursor-pointer ${
                          star <= reviewRating ? 'text-amber-400' : 'text-slate-200'
                        }`}
                      >
                        ★
                      </button>
                    ))}
                    <span className="text-xs font-semibold text-slate-500 ml-2">
                      {reviewRating === 5
                        ? '⭐⭐⭐⭐⭐ Excellent'
                        : reviewRating === 4
                        ? '⭐⭐⭐⭐ Good'
                        : reviewRating === 3
                        ? '⭐⭐⭐ Average'
                        : reviewRating === 2
                        ? '⭐⭐ Needs Coaching'
                        : reviewRating === 1
                        ? '⭐ Poor / Malworking'
                        : 'Unrated'}
                    </span>
                  </div>
                </div>

                {/* Quick Tag Pills */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Quick Audit Tags</label>
                  <div className="flex flex-wrap gap-1.5">
                    {['Great Pitch', 'Follow-up Needed', 'Price Objection', 'Rushed / Short', 'Misconduct / Flagged'].map(
                      (tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => setReviewNotes((prev) => (prev ? `${prev}, ${tag}` : tag))}
                          className="px-2 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-medium border border-slate-200 transition-colors cursor-pointer"
                        >
                          + {tag}
                        </button>
                      )
                    )}
                  </div>
                </div>

                {/* Notes Textarea */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Manager Coaching Notes</label>
                  <textarea
                    rows={3}
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    placeholder="Add coaching feedback, notes, or customer response details..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>

                {/* Bookmark Toggle */}
                <label className="flex items-center space-x-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={reviewBookmark}
                    onChange={(e) => setReviewBookmark(e.target.checked)}
                    className="w-4 h-4 text-brand-600 rounded border-slate-300 focus:ring-brand-500"
                  />
                  <span className="text-xs font-semibold text-slate-700">⭐ Bookmark as exemplary call for team library</span>
                </label>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setReviewingCall(null)}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveReview}
                  disabled={savingReview}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-slate-900 hover:bg-black transition-all shadow-sm cursor-pointer disabled:opacity-50"
                >
                  {savingReview ? 'Saving...' : 'Save Review'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Super Admin: Add Call Log Modal */}
        {isAddCallModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
            <div className="bg-white rounded-2xl p-6 max-w-lg w-full shadow-2xl border border-slate-200 space-y-4 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900">Add Call Log</h3>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">
                    Super Admin Console • Manually Insert Call Record
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsAddCallModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSaveNewCall} className="space-y-4 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Counselor / Agent */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Counselor / Agent</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Shrishti K"
                      value={callFormAgent}
                      onChange={(e) => setCallFormAgent(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                    />
                  </div>

                  {/* Customer / Lead Name */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Customer / Lead Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Dr. Rajesh Kumar"
                      value={callFormLead}
                      onChange={(e) => setCallFormLead(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                    />
                  </div>
                </div>

                {/* Phone Number */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Phone Number</label>
                  <input
                    type="text"
                    required
                    placeholder="+91 99361 67436"
                    value={callFormPhone}
                    onChange={(e) => setCallFormPhone(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs font-mono text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Channel / Type */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Channel</label>
                    <select
                      value={callFormChannel}
                      onChange={(e) => setCallFormChannel(e.target.value as any)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500/20 cursor-pointer"
                    >
                      <option value="CELLULAR">SIM (Cellular)</option>
                      <option value="WHATSAPP">WhatsApp</option>
                    </select>
                  </div>

                  {/* Direction */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Direction</label>
                    <select
                      value={callFormDirection}
                      onChange={(e) => setCallFormDirection(e.target.value as any)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500/20 cursor-pointer"
                    >
                      <option value="OUTGOING">Outbound</option>
                      <option value="INCOMING">Inbound</option>
                    </select>
                  </div>

                  {/* Status */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Status</label>
                    <select
                      value={callFormStatus}
                      onChange={(e) => setCallFormStatus(e.target.value as any)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500/20 cursor-pointer"
                    >
                      <option value="ANSWERED">Answered</option>
                      <option value="UNANSWERED">Unanswered</option>
                      <option value="MISSED">Missed</option>
                      <option value="REJECTED">Rejected</option>
                    </select>
                  </div>
                </div>

                {/* Duration */}
                {callFormStatus === 'ANSWERED' && (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Call Duration</label>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex items-center space-x-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                        <input
                          type="number"
                          min="0"
                          value={callFormDurationMin}
                          onChange={(e) => setCallFormDurationMin(e.target.value)}
                          className="w-full bg-transparent text-xs font-semibold text-slate-900 outline-none"
                        />
                        <span className="text-xs text-slate-500 font-medium">Minutes</span>
                      </div>
                      <div className="flex items-center space-x-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                        <input
                          type="number"
                          min="0"
                          max="59"
                          value={callFormDurationSec}
                          onChange={(e) => setCallFormDurationSec(e.target.value)}
                          className="w-full bg-transparent text-xs font-semibold text-slate-900 outline-none"
                        />
                        <span className="text-xs text-slate-500 font-medium">Seconds</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Date & Time */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Call Date & Time</label>
                  <input
                    type="datetime-local"
                    value={callFormStartTime}
                    onChange={(e) => setCallFormStartTime(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-rose-500/20 cursor-pointer"
                  />
                </div>

                {/* Disposition & Notes */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Disposition / Course</label>
                    <input
                      type="text"
                      placeholder="e.g. NCLEX-RN Inquiry"
                      value={callFormDisposition}
                      onChange={(e) => setCallFormDisposition(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Team / Department</label>
                    <input
                      type="text"
                      placeholder="e.g. Delhi Team"
                      value={callFormTeam}
                      onChange={(e) => setCallFormTeam(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Call Notes (Optional)</label>
                  <textarea
                    rows={2}
                    placeholder="Details about discussion or outcome..."
                    value={callFormNotes}
                    onChange={(e) => setCallFormNotes(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                  />
                </div>

                <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setIsAddCallModalOpen(false)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingCallAction}
                    className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-slate-900 hover:bg-black transition-all shadow-sm cursor-pointer disabled:opacity-50 flex items-center space-x-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{savingCallAction ? 'Creating Call...' : 'Create Call Log'}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Super Admin: Edit Call Log Modal (Edit Phone Number, Lead, Agent, Duration, Status) */}
        {isEditCallModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
            <div className="bg-white rounded-2xl p-6 max-w-lg w-full shadow-2xl border border-slate-200 space-y-4 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900">Edit Call Log & Phone Number</h3>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">
                    Super Admin Console • Modify Call Record & Assigned Number
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsEditCallModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSaveEditCall} className="space-y-4 text-xs">
                {/* Phone Number (Primary field to edit) */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Phone Number <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="+91 99361 67436"
                    value={callFormPhone}
                    onChange={(e) => setCallFormPhone(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">Super Admin can edit/correct any phone number directly.</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Counselor / Agent */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Counselor / Agent</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Shrishti K"
                      value={callFormAgent}
                      onChange={(e) => setCallFormAgent(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                    />
                  </div>

                  {/* Customer / Lead Name */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Customer / Lead Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Dr. Rajesh Kumar"
                      value={callFormLead}
                      onChange={(e) => setCallFormLead(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Channel / Type */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Channel</label>
                    <select
                      value={callFormChannel}
                      onChange={(e) => setCallFormChannel(e.target.value as any)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500/20 cursor-pointer"
                    >
                      <option value="CELLULAR">SIM (Cellular)</option>
                      <option value="WHATSAPP">WhatsApp</option>
                    </select>
                  </div>

                  {/* Direction */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Direction</label>
                    <select
                      value={callFormDirection}
                      onChange={(e) => setCallFormDirection(e.target.value as any)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500/20 cursor-pointer"
                    >
                      <option value="OUTGOING">Outbound</option>
                      <option value="INCOMING">Inbound</option>
                    </select>
                  </div>

                  {/* Status */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Status</label>
                    <select
                      value={callFormStatus}
                      onChange={(e) => setCallFormStatus(e.target.value as any)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500/20 cursor-pointer"
                    >
                      <option value="ANSWERED">Answered</option>
                      <option value="UNANSWERED">Unanswered</option>
                      <option value="MISSED">Missed</option>
                      <option value="REJECTED">Rejected</option>
                    </select>
                  </div>
                </div>

                {/* Duration */}
                {callFormStatus === 'ANSWERED' && (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Call Duration</label>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex items-center space-x-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                        <input
                          type="number"
                          min="0"
                          value={callFormDurationMin}
                          onChange={(e) => setCallFormDurationMin(e.target.value)}
                          className="w-full bg-transparent text-xs font-semibold text-slate-900 outline-none"
                        />
                        <span className="text-xs text-slate-500 font-medium">Minutes</span>
                      </div>
                      <div className="flex items-center space-x-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                        <input
                          type="number"
                          min="0"
                          max="59"
                          value={callFormDurationSec}
                          onChange={(e) => setCallFormDurationSec(e.target.value)}
                          className="w-full bg-transparent text-xs font-semibold text-slate-900 outline-none"
                        />
                        <span className="text-xs text-slate-500 font-medium">Seconds</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Date & Time */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Call Date & Time</label>
                  <input
                    type="datetime-local"
                    value={callFormStartTime}
                    onChange={(e) => setCallFormStartTime(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-rose-500/20 cursor-pointer"
                  />
                </div>

                {/* Disposition & Notes */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Disposition / Course</label>
                    <input
                      type="text"
                      placeholder="e.g. NCLEX-RN Inquiry"
                      value={callFormDisposition}
                      onChange={(e) => setCallFormDisposition(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Team / Department</label>
                    <input
                      type="text"
                      placeholder="e.g. Delhi Team"
                      value={callFormTeam}
                      onChange={(e) => setCallFormTeam(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Call Notes</label>
                  <textarea
                    rows={2}
                    placeholder="Details about discussion or outcome..."
                    value={callFormNotes}
                    onChange={(e) => setCallFormNotes(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                  />
                </div>

                <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setIsEditCallModalOpen(false)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingCallAction}
                    className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-slate-900 hover:bg-black transition-all shadow-sm cursor-pointer disabled:opacity-50 flex items-center space-x-1.5"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{savingCallAction ? 'Saving...' : 'Save Changes'}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function SalestrailCallsPage() {
  return (
    <Suspense fallback={<div className="flex h-screen bg-[#f8fafc] text-slate-900 font-sans"><main className="flex-1 p-8">Loading calls...</main></div>}>
      <SalestrailCallsInner />
    </Suspense>
  );
}
