import { cacheGet, cacheSet, cacheDel } from './cache';
import { connectToDatabase, withDbRetry } from './db';
import { CallModel, DeviceModel, UserModel, TeamModel } from './models';

export const CALLS_CACHE_KEY = 'cache:calls:latest';
export const CALLS_CACHE_TTL = 86400; // 24 hours cache TTL (kept fresh via incremental sync)

export const COUNSELORS_CACHE_KEY = 'cache:auth:counselors';
export const COUNSELORS_CACHE_TTL = 300; // 5 minutes

export const TEAMS_CACHE_KEY = 'cache:teams:list';
export const TEAMS_CACHE_TTL = 300; // 5 minutes

export const DASHBOARD_SUMMARY_CACHE_KEY = 'cache:dashboard:summary';
export const DASHBOARD_SUMMARY_CACHE_TTL = 60; // 60 seconds
export const MAX_CACHED_CALLS = 2500; // Optimal recent calls cache capacity for fast <200ms page loads

let isRebuildingCalls = false;
let lastRebuildTimestamp = 0;
let activeRebuildCallsPromise: Promise<any[]> | null = null;
const MIN_REBUILD_INTERVAL_MS = 5000; // Throttle full rebuilds to at most once per 5 seconds

/**
 * Normalizes and formats domestic and international phone numbers, preserving their true country code:
 * - Pakistan (+92): "+92 313 2323522"
 * - India (+91): "+91 98765 43210"
 * - USA/Canada (+1): "+1 212 555 1234"
 * - UK (+44): "+44 7911 123456"
 * - UAE (+971): "+971 50 1234567"
 * - Saudi (+966): "+966 50 1234567"
 */
export function formatPhoneNumber(rawPhone: string): string {
  if (!rawPhone) return '';
  const trimmed = rawPhone.trim();

  // If it's a contact name with words and no '+', return it
  if (/[a-zA-Z]/.test(trimmed) && !trimmed.startsWith('+')) {
    return trimmed;
  }

  // 1. Explicit '+' country code prefix
  if (trimmed.startsWith('+')) {
    const digits = trimmed.replace(/\D/g, '');
    if (digits.startsWith('92') && digits.length === 12) {
      return `+92 ${digits.slice(2, 5)} ${digits.slice(5)}`;
    }
    if (digits.startsWith('91') && digits.length === 12) {
      return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
    }
    if (digits.startsWith('1') && digits.length === 11) {
      return `+1 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
    }
    if (digits.startsWith('44') && digits.length >= 12) {
      return `+44 ${digits.slice(2, 6)} ${digits.slice(6)}`;
    }
    if (digits.startsWith('971') && digits.length >= 11) {
      return `+971 ${digits.slice(3, 5)} ${digits.slice(5)}`;
    }
    if (digits.startsWith('966') && digits.length >= 11) {
      return `+966 ${digits.slice(3, 5)} ${digits.slice(5)}`;
    }
    if (digits.startsWith('61') && digits.length >= 11) {
      return `+61 ${digits.slice(2, 5)} ${digits.slice(5)}`;
    }
    return `+${digits}`;
  }

  const digitsOnly = trimmed.replace(/\D/g, '');

  // 2. Unprefixed numbers with recognized international prefixes
  if (digitsOnly.startsWith('92') && digitsOnly.length === 12) {
    return `+92 ${digitsOnly.slice(2, 5)} ${digitsOnly.slice(5)}`;
  }
  if (digitsOnly.startsWith('91') && digitsOnly.length === 12) {
    return `+91 ${digitsOnly.slice(2, 7)} ${digitsOnly.slice(7)}`;
  }
  if (digitsOnly.startsWith('1') && digitsOnly.length === 11) {
    return `+1 ${digitsOnly.slice(1, 4)} ${digitsOnly.slice(4, 7)} ${digitsOnly.slice(7)}`;
  }
  if (digitsOnly.startsWith('0') && digitsOnly.length === 11) {
    const c10 = digitsOnly.slice(1);
    return `+91 ${c10.slice(0, 5)} ${c10.slice(5)}`;
  }
  if (digitsOnly.length === 10) {
    return `+91 ${digitsOnly.slice(0, 5)} ${digitsOnly.slice(5)}`;
  }
  if (digitsOnly.length > 10) {
    return `+${digitsOnly}`;
  }
  return rawPhone;
}

/**
 * Fast O(N) deduplication for call records by unique database _id or idempotencyKey.
 * Preserves the database sorted order (newest first).
 */
export function deduplicateCalls(calls: any[]): any[] {
  if (!calls || calls.length === 0) return [];

  const seen = new Set<string>();
  const deduplicated: any[] = [];

  for (const call of calls) {
    const key = (call._id ? call._id.toString() : '') || call.idempotencyKey || `call_${Date.now()}_${Math.random()}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(call);
    }
  }

  return deduplicated;
}

/**
 * Rebuilds the calls cache from MongoDB Atlas, enriches device metadata, and saves to in-memory cache.
 */
export async function rebuildCallsCache(): Promise<any[]> {
  if (activeRebuildCallsPromise) {
    return activeRebuildCallsPromise;
  }

  activeRebuildCallsPromise = (async () => {
    isRebuildingCalls = true;
    lastRebuildTimestamp = Date.now();

    try {
      console.log('[rebuildCallsCache] Starting MongoDB query for up to', MAX_CACHED_CALLS, 'calls...');
      const rawCalls = await withDbRetry(async () => {
        return await (CallModel as any)
          .find()
          .select('idempotencyKey phoneNumber phoneNumberMasked direction status startTime endTime durationSeconds simSlot isPrivate disposition channel agentName counselorEmail leadName recordingStatus s3Key audioUrl notes team deviceId createdAt updatedAt')
          .sort({ startTime: -1, createdAt: -1 })
          .limit(MAX_CACHED_CALLS)
          .lean()
          .exec();
      });

      console.log('[rebuildCallsCache] MongoDB returned rawCalls count:', rawCalls?.length);

      if (!rawCalls || rawCalls.length === 0) {
        isRebuildingCalls = false;
        return [];
      }

      // Enrich agent names from registered devices
      try {
        const registeredDevices = await (DeviceModel as any).find().select('deviceId agentName counselorEmail').lean().exec();
        if (registeredDevices && registeredDevices.length > 0) {
          const deviceAgentMap = new Map<string, string>();
          for (const dev of registeredDevices) {
            if (dev.deviceId && (dev.agentName || dev.counselorEmail)) {
              const name =
                dev.agentName && dev.agentName !== 'Counselor Agent' && dev.agentName !== 'Counselor'
                  ? dev.agentName
                  : dev.counselorEmail
                  ? dev.counselorEmail
                      .split('@')[0]
                      .replace(/[._]/g, ' ')
                      .replace(/\b\w/g, (l: string) => l.toUpperCase())
                  : null;
              if (name) {
                deviceAgentMap.set(dev.deviceId, name);
              }
            }
          }

          for (const call of rawCalls) {
            if (
              (!call.agentName || call.agentName === 'Counselor Agent' || call.agentName === 'Counselor') &&
              call.deviceId &&
              deviceAgentMap.has(call.deviceId)
            ) {
              call.agentName = deviceAgentMap.get(call.deviceId);
            }
          }
        }
      } catch (devErr) {
        console.warn('Cache service device enrichment notice:', devErr);
      }

      // Clean text/chat messages & format phone numbers
      const cleanCalls = rawCalls
        .filter((c: any) => {
          const fullStr = `${c.phoneNumber || ''} ${c.leadName || ''} ${c.disposition || ''}`.toLowerCase();
          return (
            !fullStr.includes('message') &&
            !fullStr.includes('messages') &&
            !fullStr.includes('unread') &&
            !fullStr.includes('mention') &&
            !fullStr.includes('group:')
          );
        })
        .map((c: any) => {
          const formatted = formatPhoneNumber(c.phoneNumber || c.phoneNumberMasked || '');
          if (formatted) {
            c.phoneNumber = formatted;
            c.phoneNumberMasked = formatted;
          }
          const isAns = (c.status || 'ANSWERED').toUpperCase() === 'ANSWERED';
          if (!isAns) {
            c.durationSeconds = 0;
          }
          return c;
        });

      const deduplicated = deduplicateCalls(cleanCalls);
      console.log('[rebuildCallsCache] Successfully prepared deduplicated calls:', deduplicated.length);

      // Save into in-memory cache
      if (deduplicated && deduplicated.length > 0) {
        await cacheSet(CALLS_CACHE_KEY, deduplicated, CALLS_CACHE_TTL);
      }

      return deduplicated;
    } catch (err) {
      console.error('Error rebuilding calls cache:', err);
      return [];
    } finally {
    isRebuildingCalls = false;
    activeRebuildCallsPromise = null;
  }
  })();

  return activeRebuildCallsPromise;
}

/**
 * Fast-path retrieval of calls: Returns cached data immediately (<5ms).
 * If cache is completely missing (cold start), builds cache synchronously once.
 */
export async function getCallsWithCache(): Promise<{ calls: any[]; cacheHit: boolean }> {
  const cached = await cacheGet<any[]>(CALLS_CACHE_KEY);
  if (cached && Array.isArray(cached) && cached.length > 0) {
    return { calls: cached, cacheHit: true };
  }

  // Cold start / Cache miss: Rebuild and store in in-memory cache
  const calls = await rebuildCallsCache();
  return { calls, cacheHit: false };
}

/**
 * Triggers an asynchronous non-blocking background revalidation of the calls cache with rate-limiting.
 */
export function revalidateCallsCacheInBackground(force = false): void {
  const now = Date.now();
  if (!force && now - lastRebuildTimestamp < MIN_REBUILD_INTERVAL_MS) {
    // Throttled: Recent cache rebuild occurred within the throttle window
    return;
  }

  setTimeout(() => {
    rebuildCallsCache().catch((err) => {
      console.warn('Background cache revalidation error:', err);
    });
  }, 100);
}

/**
 * Updates the existing cache with a new batch of calls from mobile sync (Non-destructive).
 * Operates purely in-memory without triggering full MongoDB database scans.
 */
export async function updateCallsCacheWithNewBatch(newCalls: any[]): Promise<void> {
  if (!newCalls || newCalls.length === 0) return;

  try {
    const formattedBatch = newCalls.map((c: any) => {
      const formatted = formatPhoneNumber(c.phoneNumber || c.phoneNumberMasked || '');
      return {
        ...c,
        phoneNumber: formatted || c.phoneNumber,
        phoneNumberMasked: formatted || c.phoneNumberMasked,
      };
    });

    const existing = await cacheGet<any[]>(CALLS_CACHE_KEY);
    if (existing && Array.isArray(existing) && existing.length > 0) {
      const merged = deduplicateCalls([...formattedBatch, ...existing]).slice(0, MAX_CACHED_CALLS);
      await cacheSet(CALLS_CACHE_KEY, merged, CALLS_CACHE_TTL);
    } else {
      revalidateCallsCacheInBackground(true);
    }
  } catch (err) {
    console.warn('Error updating calls cache with new batch:', err);
  }
}

/**
 * Updates a specific call in cache (e.g. audio upload, rating, bookmark) without deleting the cache.
 */
export async function patchCallInCache(callId: string, updates: Record<string, any>): Promise<void> {
  if (!callId) return;

  try {
    const existing = await cacheGet<any[]>(CALLS_CACHE_KEY);
    if (existing && Array.isArray(existing) && existing.length > 0) {
      let found = false;
      const updated = existing.map((c) => {
        const isMatch =
          (c._id && String(c._id) === String(callId)) ||
          (c.id && String(c.id) === String(callId)) ||
          (c.idempotencyKey && String(c.idempotencyKey) === String(callId));
        if (isMatch) {
          found = true;
          return { ...c, ...updates };
        }
        return c;
      });

      if (found) {
        await cacheSet(CALLS_CACHE_KEY, updated, CALLS_CACHE_TTL);
      }
    }
  } catch (err) {
    console.warn('Error patching call in cache:', err);
  }
}

/**
 * Executes a fast, targeted indexed query directly against MongoDB for specific filters or date ranges.
 */
export async function queryCallsFromDb(filters: {
  counselorEmail?: string;
  agentName?: string;
  team?: string;
  startDate?: string | Date;
  endDate?: string | Date;
  search?: string;
  channel?: string;
  status?: string;
  limit?: number;
  skip?: number;
}): Promise<any[]> {
  try {
    return await withDbRetry(async () => {
      const query: any = {};

      if (filters.counselorEmail) {
        const escEmail = filters.counselorEmail.toLowerCase().trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        query.counselorEmail = { $regex: `^${escEmail}$`, $options: 'i' };
      } else if (filters.agentName) {
        const escAgent = filters.agentName.trim().split(/\s+/).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
        query.agentName = { $regex: `^${escAgent}$`, $options: 'i' };
      }

      if (filters.team) {
        query.team = filters.team.trim();
      }

      if (filters.channel) {
        query.channel = filters.channel.toUpperCase().trim();
      }

      if (filters.status) {
        query.status = filters.status.toUpperCase().trim();
      }

      if (filters.startDate || filters.endDate) {
        query.startTime = {};
        if (filters.startDate) {
          query.startTime.$gte = new Date(filters.startDate);
        }
        if (filters.endDate) {
          query.startTime.$lte = new Date(filters.endDate);
        }
      }

      if (filters.search) {
        const term = filters.search.trim();
        query.$or = [
          { phoneNumber: { $regex: term, $options: 'i' } },
          { phoneNumberMasked: { $regex: term, $options: 'i' } },
          { leadName: { $regex: term, $options: 'i' } },
        ];
      }

      const limit = Math.min(filters.limit || 1000, 5000);
      const skip = filters.skip || 0;

      const rawCalls = await (CallModel as any)
        .find(query)
        .select('idempotencyKey phoneNumber phoneNumberMasked direction status startTime endTime durationSeconds simSlot isPrivate disposition channel agentName counselorEmail leadName recordingStatus s3Key audioUrl notes team deviceId createdAt updatedAt')
        .sort({ startTime: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec();

      return deduplicateCalls(rawCalls.map((c: any) => {
        const formatted = formatPhoneNumber(c.phoneNumber || c.phoneNumberMasked || '');
        if (formatted) {
          c.phoneNumber = formatted;
          c.phoneNumberMasked = formatted;
        }
        return c;
      }));
    });
  } catch (err) {
    console.error('Error executing queryCallsFromDb:', err);
    return [];
  }
}
