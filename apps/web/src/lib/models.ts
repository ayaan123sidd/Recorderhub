import mongoose, { Schema } from 'mongoose';

const UserSchema = new Schema(
  {
    email: { type: String, required: true },
    passwordHash: { type: String, required: true },
    firstName: { type: String, required: true },
    lastName: { type: String, default: '' },
    role: { type: String, default: 'COUNSELOR' },
    phoneNumber: { type: String, default: '' },
    organizationId: { type: String, default: '65c1f0000000000000000001' },
    isActive: { type: Boolean, default: true },
    isGuest: { type: Boolean, default: false },
    resignedAt: { type: Date },
  },
  { timestamps: true },
);

const CallSchema = new Schema(
  {
    organizationId: { type: String, default: '65c1f0000000000000000001' },
    userId: { type: String },
    agentName: { type: String, default: 'Counselor Agent' },
    deviceId: { type: String, default: 'ANDROID-XIAOMI-PROD' },
    idempotencyKey: { type: String },
    phoneNumber: { type: String },
    phoneNumberMasked: { type: String },
    phoneNumberHash: { type: String },
    direction: { type: String, default: 'INCOMING' },
    status: { type: String, default: 'ANSWERED' },
    channel: { type: String, default: 'CELLULAR' },
    startTime: { type: Date },
    endTime: { type: Date },
    durationSeconds: { type: Number, default: 0 },
    simSlot: { type: Number, default: 0 },
    isPrivate: { type: Boolean, default: false },
    recordingStatus: { type: String, default: 'NONE' },
    disposition: { type: String, default: 'Imported Phone Call' },
    leadId: { type: String },
    leadName: { type: String },
  },
  { timestamps: true, strict: false },
);

const DeviceSchema = new Schema(
  {
    organizationId: { type: String, default: '65c1f0000000000000000001' },
    userId: { type: String },
    agentName: { type: String, default: 'Counselor Agent' },
    deviceId: { type: String, required: true },
    deviceModel: { type: String, default: 'Xiaomi Phone' },
    androidVersion: { type: String, default: 'Android 14' },
    appVersion: { type: String, default: 'v1.0.4' },
    batteryOptimizationDisabled: { type: Boolean, default: true },
    safDirectoryAuthorized: { type: Boolean, default: true },
    lastSyncTimestamp: { type: Date, default: Date.now },
    failedUploadCount: { type: Number, default: 0 },
    pendingSyncCount: { type: Number, default: 0 },
    status: { type: String, default: 'HEALTHY' },
  },
  { timestamps: true },
);

const TeamSchema = new Schema(
  {
    organizationId: { type: String, default: '65c1f0000000000000000001' },
    name: { type: String, required: true, trim: true },
    admin: { type: String, default: 'Rajdeep' },
    admins: [{ type: String }],
    teamLeadId: { type: String },
    teamLeadEmail: { type: String },
    members: [{ type: String }],
    installedRatio: { type: String, default: '0 / 0' },
  },
  { timestamps: true },
);

const AppReleaseSchema = new Schema(
  {
    versionName: { type: String, required: true },
    versionCode: { type: Number, required: true, unique: true },
    downloadUrl: { type: String, required: true },
    fileSizeBytes: { type: Number, default: 0 },
    releaseNotes: { type: String, default: '' },
    isForced: { type: Boolean, default: false },
    minSupportedVersionCode: { type: Number, default: 1 },
    isActive: { type: Boolean, default: true },
    uploadedBy: { type: String, default: 'Admin' },
    s3Key: { type: String },
  },
  { timestamps: true }
);

CallSchema.index({ startTime: -1, createdAt: -1 });
CallSchema.index({ phoneNumber: 1, startTime: -1 });
CallSchema.index({ idempotencyKey: 1 }, { sparse: true });
CallSchema.index({ deviceId: 1, startTime: -1 });
CallSchema.index({ counselorEmail: 1, startTime: -1 });
CallSchema.index({ agentName: 1, startTime: -1 });
CallSchema.index({ team: 1, startTime: -1 });
CallSchema.index({ recordingStatus: 1 });
CallSchema.index({ s3Key: 1 }, { sparse: true });
CallSchema.index({ audioUrl: 1 }, { sparse: true });
CallSchema.index({ status: 1, durationSeconds: 1 });

UserSchema.index({ email: 1 });
UserSchema.index({ role: 1 });

TeamSchema.index({ name: 1 });
TeamSchema.index({ teamLeadEmail: 1 });
TeamSchema.index({ teamLeadId: 1 });

DeviceSchema.index({ deviceId: 1 });
DeviceSchema.index({ counselorEmail: 1 });
DeviceSchema.index({ lastSyncTimestamp: -1 });

AppReleaseSchema.index({ versionCode: -1 });
AppReleaseSchema.index({ isActive: 1, versionCode: -1 });

const AuditLogSchema = new Schema(
  {
    organizationId: { type: String, default: '65c1f0000000000000000001' },
    actorUserId: { type: String },
    userEmail: { type: String, required: true },
    userName: { type: String, default: '' },
    userRole: { type: String, default: 'COUNSELOR' },
    action: { type: String, required: true },
    actionCategory: { type: String, default: 'DASHBOARD' },
    description: { type: String, required: true },
    targetResource: { type: String, default: 'DASHBOARD' },
    path: { type: String, default: '/dashboard' },
    details: { type: Schema.Types.Mixed, default: {} },
    ipAddress: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    device: { type: String, default: 'Desktop' },
    timestamp: { type: Date, default: Date.now },
  },
  { timestamps: true, collection: 'auditlogs' }
);

AuditLogSchema.index({ timestamp: -1, createdAt: -1 });
AuditLogSchema.index({ userEmail: 1, timestamp: -1 });
AuditLogSchema.index({ action: 1, timestamp: -1 });
AuditLogSchema.index({ actionCategory: 1, timestamp: -1 });
AuditLogSchema.index({ organizationId: 1, timestamp: -1 });

const ActivityItemSchema = new Schema(
  {
    action: { type: String, required: true },
    actionCategory: { type: String, default: 'GENERAL' },
    description: { type: String, required: true },
    path: { type: String, default: '/dashboard' },
    details: { type: Schema.Types.Mixed, default: {} },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: true }
);

const UserSessionSchema = new Schema(
  {
    organizationId: { type: String, default: '65c1f0000000000000000001' },
    sessionId: { type: String, required: true },
    userEmail: { type: String, required: true },
    userName: { type: String, default: '' },
    userRole: { type: String, default: 'COUNSELOR' },
    startedAt: { type: Date, default: Date.now },
    lastActiveAt: { type: Date, default: Date.now },
    ipAddress: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    device: { type: String, default: 'Desktop' },
    currentPath: { type: String, default: '/dashboard' },
    status: { type: String, default: 'ACTIVE' },
    activities: [ActivityItemSchema],
    totalActions: { type: Number, default: 1 },
  },
  { timestamps: true, collection: 'usersessions' }
);

UserSessionSchema.index({ startedAt: -1, lastActiveAt: -1 });
UserSessionSchema.index({ userEmail: 1, lastActiveAt: -1 });
UserSessionSchema.index({ sessionId: 1 });
UserSessionSchema.index({ organizationId: 1, lastActiveAt: -1 });

export const UserModel = mongoose.models.User || mongoose.model('User', UserSchema);
export const CallModel = mongoose.models.Call || mongoose.model('Call', CallSchema);
export const DeviceModel = mongoose.models.Device || mongoose.model('Device', DeviceSchema);
export const TeamModel = mongoose.models.Team || mongoose.model('Team', TeamSchema);
export const AppReleaseModel = mongoose.models.AppRelease || mongoose.model('AppRelease', AppReleaseSchema);
export const AuditLogModel = mongoose.models.AuditLog || mongoose.model('AuditLog', AuditLogSchema);
export const UserSessionModel = mongoose.models.UserSession || mongoose.model('UserSession', UserSessionSchema);

const SystemSettingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed, required: true },
    description: { type: String, default: '' },
    updatedBy: { type: String, default: 'System' },
  },
  { timestamps: true, collection: 'systemsettings' }
);

export const SystemSettingModel = mongoose.models.SystemSetting || mongoose.model('SystemSetting', SystemSettingSchema);





