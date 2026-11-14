# RecordHub: MongoDB Schema & Data Model Specification

## Overview
RecordHub uses MongoDB with Mongoose ODM. All collection schemas strictly enforce organization-scoped multi-tenancy using compound indexes containing `organization_id`.

---

## 1. Core Entity Collections & Fields

### 1.1 `organizations`
* `_id`: ObjectId / UUID String
* `name`: String (e.g., "Academically Global Healthcare Academy")
* `slug`: String (unique)
* `country`: String (e.g., "IN")
* `timezone`: String (e.g., "Asia/Kolkata")
* `is_active`: Boolean
* `createdAt`, `updatedAt`: Date

### 1.2 `organization_policies`
* `organization_id`: ObjectId (Ref: Organization, Indexed)
* `office_hours`: `{ start: "09:30", end: "18:30", daysOfWeek: [1,2,3,4,5,6] }`
* `allowed_tracking_types`: `["INCOMING", "OUTGOING", "MISSED", "REJECTED"]`
* `private_call_policy_enabled`: Boolean
* `recording_retention_days`: Number (e.g., 365 - 1 Year)
* `transcript_retention_days`: Number (e.g., 365 - 1 Year)
* `auto_redact_pii`: Boolean

### 1.3 `users`
* `_id`: ObjectId / UUID
* `organization_id`: ObjectId (Indexed)
* `email`: String (Unique index within org)
* `password_hash`: String
* `first_name`, `last_name`: String
* `role`: Enum `["SUPER_ADMIN", "COMPANY_ADMIN", "SALES_MANAGER", "QA_TRAINER", "SALES_AGENT", "AUDITOR"]`
* `phone_number`: String (E.164)
* `assigned_sim_numbers`: `[String]`
* `is_active`: Boolean

### 1.4 `teams`
* `_id`: ObjectId
* `organization_id`: ObjectId (Indexed)
* `name`: String (e.g., "NCLEX-RN Admissions Team")
* `manager_ids`: `[ObjectId]` (Ref: User)
* `description`: String

### 1.5 `calls`
* `_id`: ObjectId / UUID String
* `organization_id`: ObjectId (Indexed)
* `user_id`: ObjectId (Ref: User, Indexed)
* `team_id`: ObjectId (Ref: Team, Indexed)
* `device_id`: String (Indexed)
* `idempotency_key`: String (Unique compound index with `organization_id`)
* `phone_number_masked`: String (e.g., "+91 ****** 4321")
* `phone_number_hash`: String (SHA-256 for searching without revealing cleartext PII)
* `direction`: Enum `["INCOMING", "OUTGOING"]`
* `status`: Enum `["ANSWERED", "MISSED", "REJECTED", "FAILED"]`
* `start_time`: Date (Indexed)
* `end_time`: Date
* `duration_seconds`: Number
* `sim_slot`: Number (0 or 1)
* `is_private`: Boolean (Default false)
* `recording_status`: Enum `["NONE", "PENDING_UPLOAD", "UPLOADED", "PROCESSED", "FAILED"]`
* `disposition`: String
* `lead_id`: String (Ref: Pharmlly CRM Lead ID)

### 1.6 `recordings`
* `_id`: ObjectId
* `organization_id`: ObjectId (Indexed)
* `call_id`: ObjectId (Ref: Call, Indexed)
* `s3_bucket`: String
* `s3_key`: String (e.g., `organizations/{orgId}/recordings/2026/08/{callId}/{recordingId}.m4a`)
* `file_size_bytes`: Number
* `mime_type`: String (e.g., `audio/m4a`)
* `checksum_sha256`: String
* `duration_seconds`: Number
* `kms_key_arn`: String
* `upload_status`: Enum `["INITIATED", "COMPLETED", "FAILED"]`

### 1.7 `transcripts`
* `_id`: ObjectId
* `organization_id`: ObjectId (Indexed)
* `call_id`: ObjectId (Ref: Call, Indexed)
* `language_detected`: String (e.g., "hi-IN", "en-IN")
* `full_text`: String
* `segments`: `[{ start: Number, end: Number, speaker: String, text: String, confidence: Number }]`

### 1.8 `ai_analyses`
* `_id`: ObjectId
* `organization_id`: ObjectId (Indexed)
* `call_id`: ObjectId (Ref: Call, Indexed)
* `summary_short`: String
* `summary_detailed`: String
* `customer_intent`: String
* `interest_level`: Enum `["HIGH", "MEDIUM", "LOW", "NOT_INTERESTED"]`
* `programs_discussed`: `[String]`
* `objections`: `[{ timestamp_start: Number, objection_type: String, transcript_excerpt: String, agent_response: String }]`
* `overall_score`: Number (0-100)
* `rubric_breakdown`: `[{ category: String, score: Number, max_score: Number, justification: String }]`
* `coaching_tips`: `[String]`
* `needs_human_review`: Boolean
* `manager_score_override`: Number
* `override_reason`: String

### 1.9 `audit_logs`
* `_id`: ObjectId
* `organization_id`: ObjectId (Indexed)
* `actor_user_id`: ObjectId (Ref: User)
* `action`: Enum `["CALL_VIEWED", "RECORDING_PLAYED", "RECORDING_DOWNLOADED", "POLICY_UPDATED", "SCORE_OVERRIDDEN"]`
* `target_resource`: String
* `ip_address`: String
* `user_agent`: String
* `timestamp`: Date (TTL Index after 730 days)

---

## 2. Key Database Indexing Matrix

```javascript
// Calls Collection Indexes
callsSchema.index({ organization_id: 1, user_id: 1, start_time: -1 });
callsSchema.index({ organization_id: 1, idempotency_key: 1 }, { unique: true });
callsSchema.index({ organization_id: 1, phone_number_hash: 1, start_time: -1 });

// Audit Logs Index
auditLogsSchema.index({ organization_id: 1, timestamp: -1 });
auditLogsSchema.index({ timestamp: 1 }, { expireAfterSeconds: 63072000 }); // 2-year retention TTL
```
