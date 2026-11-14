import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db';
import { UserModel } from '@/lib/models';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    await connectToDatabase();
    const body = await req.json();
    const id = params.id;
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
    return NextResponse.json(updated);
  } catch (err: any) {
    console.error('Error updating counselor:', err);
    return NextResponse.json({ message: err.message || 'Error updating counselor' }, { status: 500 });
  }
}

import { deleteCounselorCascade } from '@/lib/counselor-actions';

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = params.id;
    if (!id || id === 'undefined') {
      return NextResponse.json({ message: 'Invalid counselor ID provided' }, { status: 400 });
    }
    if (id.toLowerCase() === 'superadmin@academically.com') {
      return NextResponse.json({ message: 'Super Admin account cannot be deleted' }, { status: 403 });
    }
    const result = await deleteCounselorCascade(id);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('Error deleting counselor:', err);
    return NextResponse.json({ message: err.message || 'Error deleting counselor' }, { status: 500 });
  }
}
