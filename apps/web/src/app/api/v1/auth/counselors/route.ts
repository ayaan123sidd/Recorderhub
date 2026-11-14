import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db';
import { UserModel, DeviceModel, AppReleaseModel } from '@/lib/models';
import { cacheGet, cacheSet, cacheDel } from '@/lib/cache';
import { COUNSELORS_CACHE_KEY, COUNSELORS_CACHE_TTL } from '@/lib/cache-service';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    await connectToDatabase();

    const [counselors, devices, latestRelease] = await Promise.all([
      (UserModel as any)
        .find({
          role: { $ne: 'SUPER_ADMIN' },
          email: { $ne: 'superadmin@academically.com' },
        })
        .select('-passwordHash')
        .sort({ createdAt: -1 })
        .lean()
        .exec(),
      (DeviceModel as any).find({}).sort({ lastSyncTimestamp: -1 }).lean().exec(),
      (AppReleaseModel as any).findOne({ isActive: true }).sort({ versionCode: -1 }).lean().exec(),
    ]);

    // Build device lookup map by email, userId, and normalized agentName
    const deviceByEmail = new Map<string, any>();
    const deviceByUserId = new Map<string, any>();
    const deviceByName = new Map<string, any>();

    const normalize = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();

    devices.forEach((dev: any) => {
      if (dev.counselorEmail) {
        const em = dev.counselorEmail.toLowerCase().trim();
        if (!deviceByEmail.has(em)) deviceByEmail.set(em, dev);
      }
      if (dev.userId) {
        const uid = dev.userId.toString();
        if (!deviceByUserId.has(uid)) deviceByUserId.set(uid, dev);
      }
      if (dev.agentName) {
        const normName = normalize(dev.agentName);
        if (normName && !deviceByName.has(normName)) {
          deviceByName.set(normName, dev);
        }
      }
    });

    const latestVerName = latestRelease?.versionName || '';
    const latestVerCode = latestRelease?.versionCode || 0;

    const enrichedCounselors = (counselors || []).map((c: any) => {
      const emailLower = (c.email || '').toLowerCase().trim();
      const userIdStr = c._id ? c._id.toString() : '';
      const fullNameNorm = normalize(`${c.firstName || ''} ${c.lastName || ''}`);
      const firstNameNorm = normalize(c.firstName || '');
      const emailPrefixNorm = normalize(emailLower.split('@')[0]);

      const device =
        deviceByEmail.get(emailLower) ||
        deviceByUserId.get(userIdStr) ||
        deviceByName.get(fullNameNorm) ||
        deviceByName.get(firstNameNorm) ||
        deviceByName.get(emailPrefixNorm) ||
        null;

      const installedVersion = device?.appVersion || null;
      let isOutdated = false;
      if (installedVersion && latestVerName) {
        const cleanInstalled = installedVersion.trim().toLowerCase().replace(/^v/, '').replace(/[-_].*$/, '');
        const cleanLatest = latestVerName.trim().toLowerCase().replace(/^v/, '').replace(/[-_].*$/, '');
        isOutdated = cleanInstalled !== cleanLatest;
      }

      return {
        ...c,
        appVersion: installedVersion,
        deviceModel: device?.deviceModel || null,
        androidVersion: device?.androidVersion || null,
        lastSyncTimestamp: device?.lastSyncTimestamp || null,
        deviceStatus: device?.status || (installedVersion ? 'HEALTHY' : 'OFFLINE'),
        isAppOutdated: isOutdated,
        latestAppVersion: latestVerName || null,
        latestAppVersionCode: latestVerCode || null,
      };
    });

    return NextResponse.json(enrichedCounselors);
  } catch (err: any) {
    console.error('Error fetching counselors:', err);
    return NextResponse.json({ message: err.message || 'Error fetching counselors' }, { status: 500 });
  }
}

import { deleteCounselorCascade } from '@/lib/counselor-actions';

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id || id === 'undefined') {
      return NextResponse.json({ message: 'Invalid counselor ID provided' }, { status: 400 });
    }

    // Protect super admin account from deletion
    if (id.toLowerCase() === 'superadmin@academically.com') {
      return NextResponse.json({ message: 'Super Admin account cannot be deleted' }, { status: 403 });
    }

    const result = await deleteCounselorCascade(id);
    await cacheDel(COUNSELORS_CACHE_KEY).catch(() => {});
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('Error deleting counselor:', err);
    return NextResponse.json({ message: err.message || 'Error deleting counselor' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    await connectToDatabase();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const body = await req.json();

    if (!id || id === 'undefined') {
      return NextResponse.json({ message: 'Invalid counselor ID provided' }, { status: 400 });
    }

    const updateData: any = {};
    if (body.firstName !== undefined) updateData.firstName = body.firstName;
    if (body.lastName !== undefined) updateData.lastName = body.lastName;
    if (body.email !== undefined) updateData.email = body.email.toLowerCase();
    if (body.phoneNumber !== undefined) updateData.phoneNumber = body.phoneNumber;

    if (body.isGuest !== undefined) {
      updateData.isGuest = Boolean(body.isGuest);
      if (updateData.isGuest) {
        updateData.role = 'GUEST';
        updateData.isActive = false;
        updateData.resignedAt = new Date();
      } else {
        updateData.resignedAt = null;
        if (body.role === 'GUEST') updateData.role = 'COUNSELOR';
      }
    }

    if (body.role !== undefined) {
      updateData.role = body.role;
      if (body.role === 'GUEST') {
        updateData.isGuest = true;
        updateData.isActive = false;
        if (!updateData.resignedAt) updateData.resignedAt = new Date();
      } else if (body.isGuest === undefined && body.role !== 'GUEST') {
        updateData.isGuest = false;
        updateData.resignedAt = null;
      }
    }

    if (body.isActive !== undefined) {
      updateData.isActive = body.isActive;
      if (body.isActive === true && updateData.isGuest !== true) {
        // If reactivating and not explicitly setting guest, make sure isGuest is false
        if (updateData.role === 'GUEST') updateData.role = 'COUNSELOR';
        updateData.isGuest = false;
        updateData.resignedAt = null;
      }
    }

    const rawPass = body.password || body.pass || body.newPassword;
    if (rawPass && typeof rawPass === 'string' && rawPass.trim().length > 0) {
      const salt = await bcrypt.genSalt(10);
      updateData.passwordHash = await bcrypt.hash(rawPass.trim(), salt);
    }

    const filter = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { email: id.toLowerCase() };
    const updated = await (UserModel as any).findOneAndUpdate(filter, { $set: updateData }, { new: true }).select('-passwordHash').exec();

    await cacheDel(COUNSELORS_CACHE_KEY).catch(() => {});

    return NextResponse.json({ success: true, data: updated });
  } catch (err: any) {
    console.error('Error updating counselor:', err);
    return NextResponse.json({ message: err.message || 'Error updating counselor' }, { status: 500 });
  }
}

