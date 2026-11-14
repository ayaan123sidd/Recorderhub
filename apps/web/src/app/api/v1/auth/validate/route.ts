import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db';
import { UserModel } from '@/lib/models';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export async function POST(req: Request) {
  try {
    await connectToDatabase();
    const body = await req.json().catch(() => ({}));
    const authHeader = req.headers.get('authorization') || '';
    const email = (body.email || '').trim().toLowerCase();

    if (!email && !authHeader) {
      return NextResponse.json(
        { valid: false, message: 'No authentication credentials provided' },
        { status: 400 }
      );
    }

    let user = null;
    if (email) {
      const emailRegex = new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
      user = await (UserModel as any).findOne({ email: { $regex: emailRegex } }).lean().exec();
    }

    if (!user) {
      return NextResponse.json(
        { valid: false, message: 'User account has been deleted or does not exist.' },
        {
          status: 401,
          headers: { 'Access-Control-Allow-Origin': '*' }
        }
      );
    }

    if ((user.role || '').toUpperCase() === 'GUEST' || user.isGuest === true) {
      return NextResponse.json(
        { valid: false, message: 'This account is marked as a Guest profile (resigned). Access is disabled.' },
        {
          status: 403,
          headers: { 'Access-Control-Allow-Origin': '*' }
        }
      );
    }

    if (user.isActive === false) {
      return NextResponse.json(
        { valid: false, message: 'User account has been deactivated by Admin.' },
        {
          status: 401,
          headers: { 'Access-Control-Allow-Origin': '*' }
        }
      );
    }

    return NextResponse.json(
      {
        valid: true,
        user: {
          id: user._id.toString(),
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
        },
      },
      {
        status: 200,
        headers: { 'Access-Control-Allow-Origin': '*' }
      }
    );
  } catch (err: any) {
    console.error('Error validating session:', err);
    return NextResponse.json(
      { valid: false, message: err.message || 'Error validating session' },
      { status: 500 }
    );
  }
}
