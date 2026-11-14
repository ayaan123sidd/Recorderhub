import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/db';
import { UserModel } from '@/lib/models';
import bcrypt from 'bcryptjs';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const DEFAULT_ACCOUNTS: Record<string, { firstName: string; lastName: string; role: string; pass: string }> = {
  'superadmin@academically.com': { firstName: 'Super', lastName: 'Admin', role: 'SUPER_ADMIN', pass: 'Academically@01' },
  'admin@academically.com': { firstName: 'System', lastName: 'Admin', role: 'ADMIN', pass: 'Academically@01' },
  'manager@academically.com': { firstName: 'Sales', lastName: 'Manager', role: 'MANAGER', pass: 'Academically@01' },
  'sachinnegi@academically.com': { firstName: 'Sachin', lastName: 'Negi', role: 'TEAM_LEAD', pass: 'Academically@01' },
  'shrishtik@academically.com': { firstName: 'Shrishti', lastName: 'K', role: 'COUNSELOR', pass: 'Academically@01' },
  'dev@academically.com': { firstName: 'Dev', lastName: 'Admin', role: 'TEAM_LEAD', pass: 'Academically@01' },
  'rajdeep@academically.com': { firstName: 'Rajdeep', lastName: '', role: 'TEAM_LEAD', pass: 'Academically@01' },
  'nasreen@academically.com': { firstName: 'Nasreen', lastName: '', role: 'COUNSELOR', pass: 'Academically@01' },
  'vasantha@academically.com': { firstName: 'Vasantha', lastName: '', role: 'COUNSELOR', pass: 'Academically@01' },
  'manas@academically.com': { firstName: 'Manas', lastName: 'Vikas', role: 'COUNSELOR', pass: 'Academically@01' },
};

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = (body.email || '').trim().toLowerCase();
    const rawPass = (body.pass || body.password || '').trim();

    if (!email || !rawPass) {
      return NextResponse.json(
        { message: 'Email ID and password are required.' },
        { status: 400 }
      );
    }

    let user = null;
    try {
      await connectToDatabase();
      user = await (UserModel as any).findOne({ email }).exec();
    } catch (dbErr) {
      console.warn('Database lookup error during login:', dbErr);
    }

    // 1. User found in database
    if (user) {
      if ((user.role || '').toUpperCase() === 'GUEST' || user.isGuest === true) {
        return NextResponse.json(
          { message: 'This account is marked as a Guest profile (resigned). Login credentials cannot be used to log in.' },
          { status: 403 }
        );
      }

      if (user.isActive === false) {
        return NextResponse.json(
          { message: 'Your account has been deactivated. Please contact your administrator.' },
          { status: 403 }
        );
      }

      let isMatch = false;
      if (user.passwordHash) {
        try {
          isMatch = await bcrypt.compare(rawPass, user.passwordHash);
        } catch (bErr) {
          isMatch = false;
        }
      }

      // Also allow matching if standard password matches default account password
      if (!isMatch && rawPass === 'Academically@01') {
        isMatch = true;
      }

      if (!isMatch) {
        return NextResponse.json(
          { message: 'Invalid username/password' },
          { status: 401 }
        );
      }

      const token = 'jwt_' + Math.random().toString(36).substring(2);
      const resObj = NextResponse.json({
        success: true,
        accessToken: token,
        user: {
          id: user._id ? user._id.toString() : user.email,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role || 'COUNSELOR',
          createdAt: user.createdAt,
        },
      });
      resObj.cookies.set('recordhub_session', token, {
        path: '/',
        maxAge: 60 * 60 * 24 * 30, // 30 days
        sameSite: 'lax',
        httpOnly: false,
      });
      return resObj;
    }

    // 2. User not in database yet - check pre-configured organization accounts
    const defaultAcc = DEFAULT_ACCOUNTS[email];
    if (defaultAcc) {
      if (rawPass !== defaultAcc.pass) {
        return NextResponse.json(
          { message: 'Invalid username/password' },
          { status: 401 }
        );
      }

      const token = 'jwt_' + Math.random().toString(36).substring(2);

      // Provision user into MongoDB
      try {
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(defaultAcc.pass, salt);
        const createdUser = await (UserModel as any).create({
          email,
          firstName: defaultAcc.firstName,
          lastName: defaultAcc.lastName,
          role: defaultAcc.role,
          passwordHash,
          isActive: true,
        });

        const resObj = NextResponse.json({
          success: true,
          accessToken: token,
          user: {
            id: createdUser._id.toString(),
            email: createdUser.email,
            firstName: createdUser.firstName,
            lastName: createdUser.lastName,
            role: createdUser.role,
            createdAt: createdUser.createdAt,
          },
        });
        resObj.cookies.set('recordhub_session', token, {
          path: '/',
          maxAge: 60 * 60 * 24 * 30,
          sameSite: 'lax',
          httpOnly: false,
        });
        return resObj;
      } catch (createErr) {
        // Fallback response if DB write fails
        const resObj = NextResponse.json({
          success: true,
          accessToken: token,
          user: {
            id: email,
            email,
            firstName: defaultAcc.firstName,
            lastName: defaultAcc.lastName,
            role: defaultAcc.role,
          },
        });
        resObj.cookies.set('recordhub_session', token, {
          path: '/',
          maxAge: 60 * 60 * 24 * 30,
          sameSite: 'lax',
          httpOnly: false,
        });
        return resObj;
      }
    }

    // 3. User email not recognized
    return NextResponse.json(
      { message: 'Invalid username/password' },
      { status: 401 }
    );
  } catch (err: any) {
    console.error('Login error:', err);
    return NextResponse.json({ message: err.message || 'Error processing login request' }, { status: 500 });
  }
}
