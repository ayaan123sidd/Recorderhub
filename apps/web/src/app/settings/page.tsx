'use client';

import React, { useState, useEffect } from 'react';
import { Navigation, useUserRole } from '@/components/Navigation';
import Link from 'next/link';
import { Settings, ShieldCheck, Database, Award, Save, RefreshCw, Shield, CheckCircle2, AlertCircle, Smartphone } from 'lucide-react';
import { ApkReleaseManagerModal } from '@/components/ApkReleaseManagerModal';

export default function SettingsPage() {
  const { role: userRole, isAdmin, isSuperAdmin } = useUserRole();
  const [crmUrl, setCrmUrl] = useState('https://api.pharmlly.com/v1');
  const [retentionDays, setRetentionDays] = useState(365);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [isApkModalOpen, setIsApkModalOpen] = useState(false);

  useEffect(() => {
    fetch('/api/v1/settings/retention')
      .then((res) => res.json())
      .then((data) => {
        if (data?.retentionDays) {
          setRetentionDays(Number(data.retentionDays));
        }
      })
      .catch(() => {});
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await fetch('/api/v1/settings/retention', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retentionDays }),
      });
      const data = await res.json();
      if (res.ok) {
        setSaved(true);
        setSaveMessage(`S3 Lifecycle updated: auto-delete after ${retentionDays} days (${Math.round(retentionDays / 30)} months)`);
        setTimeout(() => setSaved(false), 4000);

        import('@/lib/activity-tracker').then(({ trackClientActivity }) => {
          trackClientActivity({
            action: 'UPDATE_SETTINGS',
            actionCategory: 'SETTINGS',
            description: `Updated S3 data retention policy to ${retentionDays} days (${Math.round(retentionDays / 30)} months)`,
            path: '/settings',
            details: { retentionDays },
          });
        }).catch(() => {});
      } else {
        setSaveMessage(data?.error || 'Failed to update S3 policy');
      }
    } catch (err: any) {
      setSaveMessage('Error saving settings');
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin && !isSuperAdmin) {
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
                Organization settings, CRM adapter configuration, and data retention policies are strictly restricted to System Administrators.
              </p>
            </div>
            <div className="pt-2">
              <Link
                href="/calls"
                className="inline-flex items-center space-x-2 bg-[#242938] hover:bg-[#1a1e29] text-white font-semibold text-xs px-5 py-2.5 rounded-xl transition-all shadow-md"
              >
                <span>Return to Call Logs</span>
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-navy-950">
      <Navigation />

      <main className="flex-1 p-8 space-y-6 overflow-y-auto">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Organization Settings & Policies</h1>
          <p className="text-sm text-slate-400">Configure Pharmlly CRM integration, weighted QA rubrics, and data retention limits</p>
        </div>

        <form onSubmit={handleSave} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Pharmlly CRM Configuration */}
          <div className="glass-panel p-6 space-y-4">
            <div className="flex items-center space-x-2 border-b border-slate-800 pb-3">
              <Database className="w-5 h-5 text-brand-400" />
              <h3 className="text-base font-bold text-white">Pharmlly CRM Adapter Settings</h3>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-300 mb-1">Pharmlly Base API URL</label>
                <input
                  type="text"
                  value={crmUrl}
                  onChange={(e) => setCrmUrl(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-brand-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">E.164 Phone Normalization Default</label>
                <input
                  type="text"
                  value="+91 (India)"
                  disabled
                  className="w-full bg-slate-950/60 border border-slate-800 rounded-lg p-2.5 text-slate-400"
                />
              </div>

              <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800/80 space-y-1">
                <p className="font-semibold text-emerald-400">Outbox Retry Strategy Active</p>
                <p className="text-slate-400 text-[11px]">Exponential backoff at 1m, 5m, 15m, 1h, 6h. Failures route to Manager Repair Queue.</p>
              </div>
            </div>
          </div>

          {/* QA Weighted Rubric Settings */}
          <div className="glass-panel p-6 space-y-4">
            <div className="flex items-center space-x-2 border-b border-slate-800 pb-3">
              <Award className="w-5 h-5 text-amber-400" />
              <h3 className="text-base font-bold text-white">Weighted QA Scoring Rubric</h3>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex justify-between items-center bg-slate-950 p-2.5 rounded border border-slate-800">
                <span className="text-slate-200">Greeting & Mandatory Disclosure</span>
                <span className="font-bold text-brand-400">10 Points</span>
              </div>
              <div className="flex justify-between items-center bg-slate-950 p-2.5 rounded border border-slate-800">
                <span className="text-slate-200">Rapport & Healthcare Empathy</span>
                <span className="font-bold text-brand-400">20 Points</span>
              </div>
              <div className="flex justify-between items-center bg-slate-950 p-2.5 rounded border border-slate-800">
                <span className="text-slate-200">Program / Exam Accuracy</span>
                <span className="font-bold text-brand-400">25 Points</span>
              </div>
              <div className="flex justify-between items-center bg-slate-950 p-2.5 rounded border border-slate-800">
                <span className="text-slate-200">Objection Handling & Fee Structure</span>
                <span className="font-bold text-brand-400">25 Points</span>
              </div>
              <div className="flex justify-between items-center bg-slate-950 p-2.5 rounded border border-slate-800">
                <span className="text-slate-200">Clear Closing & Next Step</span>
                <span className="font-bold text-brand-400">20 Points</span>
              </div>
            </div>
          </div>

          {/* Data Retention & S3 Policy */}
          <div className="lg:col-span-2 glass-panel p-6 space-y-4">
            <div className="flex items-center space-x-2 border-b border-slate-800 pb-3">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              <h3 className="text-base font-bold text-white">Data Retention & Encryption Policies</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block font-semibold text-slate-300">S3 Audio Recording Retention</label>
                  <span className="text-emerald-400 font-mono text-[11px] font-bold">
                    {retentionDays} Days (~{retentionDays >= 365 ? `${retentionDays % 365 === 0 ? Math.round(retentionDays / 365) : (retentionDays / 365).toFixed(1)} Year${retentionDays >= 730 ? 's' : ''}` : `${Math.round(retentionDays / 30)} Months`})
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="number"
                    value={retentionDays}
                    onChange={(e) => setRetentionDays(Number(e.target.value))}
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-brand-500 font-mono"
                  />
                  <div className="flex items-center space-x-1">
                    <button
                      type="button"
                      onClick={() => setRetentionDays(365)}
                      className={`px-2.5 py-2 rounded-lg text-[11px] font-bold border transition-colors ${
                        retentionDays === 365 
                          ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' 
                          : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                      }`}
                      title="Set to 1 Year (365 Days)"
                    >
                      1 Year
                    </button>
                    <button
                      type="button"
                      onClick={() => setRetentionDays(180)}
                      className={`px-2.5 py-2 rounded-lg text-[11px] font-bold border transition-colors ${
                        retentionDays === 180 
                          ? 'bg-rose-500/20 text-rose-400 border-rose-500/40' 
                          : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                      }`}
                      title="Set to 6 Months (180 Days)"
                    >
                      6 Months
                    </button>
                    <button
                      type="button"
                      onClick={() => setRetentionDays(90)}
                      className={`px-2.5 py-2 rounded-lg text-[11px] font-bold border transition-colors ${
                        retentionDays === 90 
                          ? 'bg-rose-500/20 text-rose-400 border-rose-500/40' 
                          : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                      }`}
                      title="Set to 3 Months (90 Days)"
                    >
                      3 Months
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  AWS S3 lifecycle rule automatically expires and permanently purges audio files older than {retentionDays} days. Call metadata and logs in MongoDB remain safely stored for 1 year and beyond.
                </p>
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">Transcript & AI Analysis Retention</label>
                <input
                  type="text"
                  value="365 Days (Automated TTL)"
                  disabled
                  className="w-full bg-slate-950/60 border border-slate-800 rounded-lg p-2.5 text-slate-400 font-mono"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  MongoDB TTL index automatically purges raw transcripts after 365 days.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="submit"
                disabled={saving}
                className="bg-brand-600 hover:bg-brand-500 text-white font-semibold px-6 py-2.5 rounded-lg text-xs transition-all flex items-center space-x-2 disabled:opacity-50 shadow-md shadow-brand-600/20"
              >
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span>{saving ? 'Applying S3 Policy...' : 'Save Organization Policies'}</span>
              </button>

              {saveMessage && (
                <span className={`text-xs font-semibold flex items-center space-x-1.5 ${
                  saved ? 'text-emerald-400' : 'text-rose-400'
                }`}>
                  {saved ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                  <span>{saveMessage}</span>
                </span>
              )}
            </div>
          </div>
        </form>

        {/* Android APK Over-The-Air (OTA) Auto-Update Management */}
        <div className="glass-panel p-6 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-500 flex items-center justify-center border border-rose-500/20">
                <Smartphone className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white flex items-center space-x-2">
                  <span>Android App OTA Auto-Update System</span>
                  <span className="bg-rose-500/20 text-rose-400 border border-rose-500/30 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">
                    Active
                  </span>
                </h3>
                <p className="text-xs text-slate-400">
                  Publish new APK binaries to AWS S3. Connected counselor devices will detect the new build and auto-update.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsApkModalOpen(true)}
              className="inline-flex items-center space-x-2 bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs px-5 py-2.5 rounded-xl transition-all shadow-md shadow-rose-600/20 cursor-pointer shrink-0"
            >
              <Smartphone className="w-4 h-4" />
              <span>Manage APK Releases & Upload Build</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs pt-1">
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1">
              <p className="font-semibold text-slate-300">Self-Hosted OTA</p>
              <p className="text-slate-400 text-[11px]">Direct binary delivery via AWS S3 without third-party app store fees or delays.</p>
            </div>
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1">
              <p className="font-semibold text-slate-300">Mandatory / Force Update</p>
              <p className="text-slate-400 text-[11px]">Enforce critical updates across all team devices to prevent call tracking sync issues.</p>
            </div>
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1">
              <p className="font-semibold text-slate-300">Fleet Version Tracking</p>
              <p className="text-slate-400 text-[11px]">Inspect installed APK version and phone hardware model in User Management.</p>
            </div>
          </div>
        </div>

        {/* APK Release Manager Modal */}
        <ApkReleaseManagerModal
          isOpen={isApkModalOpen}
          onClose={() => setIsApkModalOpen(false)}
        />
      </main>
    </div>
  );
}
