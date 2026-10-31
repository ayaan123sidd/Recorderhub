'use client';

import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';

export interface CallRecord {
  _id?: string;
  id?: string;
  idempotencyKey?: string;
  audioUrl?: string;
  s3Key?: string;
  recordingStatus?: string;
  status?: string;
  leadName?: string;
  name?: string;
  phoneNumber?: string;
  phone?: string;
  agentName?: string;
  counselorName?: string;
  counselorEmail?: string;
  userEmail?: string;
  startTime?: string | Date;
  durationSeconds?: number;
  direction?: string;
  channel?: string;
  disposition?: string;
  [key: string]: any;
}

export type PlaybackSpeed = 0.75 | 1 | 1.25 | 1.5 | 2;

interface AudioPlayerContextType {
  currentCall: CallRecord | null;
  audioSrc: string | null;
  isPlaying: boolean;
  isLoading: boolean;
  currentTime: number;
  duration: number;
  playbackSpeed: PlaybackSpeed;
  volume: number;
  isMuted: boolean;
  isPlayerVisible: boolean;
  hotkeyNotification: string | null;
  playCall: (call: CallRecord) => void;
  togglePlay: () => void;
  pause: () => void;
  resume: () => void;
  seek: (seconds: number) => void;
  skip: (seconds: number) => void;
  setSpeed: (speed: PlaybackSpeed) => void;
  cycleSpeed: (direction?: 'next' | 'prev') => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  closePlayer: () => void;
  setIsPlayerVisible: (visible: boolean) => void;
}

const AudioPlayerContext = createContext<AudioPlayerContextType | undefined>(undefined);

const SPEED_OPTIONS: PlaybackSpeed[] = [0.75, 1, 1.25, 1.5, 2];

export function resolveAudioUrl(call: CallRecord | null): string | null {
  if (!call) return null;
  if (call.audioUrl) return call.audioUrl;
  if (call.s3Key) return `/api/v1/recordings/stream?key=${encodeURIComponent(call.s3Key)}`;
  return null;
}

export function AudioPlayerProvider({ children }: { children: React.ReactNode }) {
  const [currentCall, setCurrentCall] = useState<CallRecord | null>(null);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(1);
  const [volume, setVolumeState] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isPlayerVisible, setIsPlayerVisible] = useState(false);
  const [hotkeyNotification, setHotkeyNotification] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const notificationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const showHotkeyToast = useCallback((msg: string) => {
    if (notificationTimeoutRef.current) {
      clearTimeout(notificationTimeoutRef.current);
    }
    setHotkeyNotification(msg);
    notificationTimeoutRef.current = setTimeout(() => {
      setHotkeyNotification(null);
    }, 1800);
  }, []);

  // Initialize HTMLAudioElement once
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audioRef.current = audio;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onWaiting = () => setIsLoading(true);
    const onPlaying = () => setIsLoading(false);
    const onCanPlay = () => setIsLoading(false);
    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };
    const onLoadedMetadata = () => {
      if (!isNaN(audio.duration) && Number.isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
      setIsLoading(false);
    };
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    const onError = () => {
      setIsLoading(false);
      setIsPlaying(false);
    };

    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    return () => {
      audio.pause();
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      audio.src = '';
    };
  }, []);

  const playCall = useCallback((call: CallRecord) => {
    const src = resolveAudioUrl(call);
    if (!src) return;

    const audio = audioRef.current;
    if (!audio) return;

    const isSameCall = currentCall && (
      (currentCall._id && currentCall._id === call._id) ||
      (currentCall.idempotencyKey && currentCall.idempotencyKey === call.idempotencyKey) ||
      (currentCall.audioUrl && currentCall.audioUrl === call.audioUrl)
    );

    if (isSameCall) {
      if (audio.paused) {
        audio.play().catch(console.error);
      } else {
        audio.pause();
      }
      return;
    }

    // Load new call
    setCurrentCall(call);
    setAudioSrc(src);
    setIsPlayerVisible(true);
    setIsLoading(true);
    setCurrentTime(0);
    setDuration(call.durationSeconds || 0);

    // Track recording playback action
    try {
      import('@/lib/activity-tracker').then(({ trackClientActivity }) => {
        const phone = call.phoneNumber || call.phoneNumberMasked || call.phone || 'Phone Call';
        const dur = call.durationSeconds ? `${call.durationSeconds}s` : 'Unknown duration';
        const agent = call.agentName || call.counselorName || call.counselorEmail || '';
        trackClientActivity({
          action: 'PLAY_RECORDING',
          actionCategory: 'RECORDINGS',
          description: `Listened to call recording of ${phone} (${dur}${agent ? `, Agent: ${agent}` : ''})`,
          path: typeof window !== 'undefined' ? window.location.pathname : '/calls',
          details: {
            callId: call._id || call.id || call.idempotencyKey,
            phoneNumber: call.phoneNumber || call.phone,
            duration: call.durationSeconds,
            agentName: agent,
          },
        });
      }).catch(() => {});
    } catch (e) {}

    audio.src = src;
    audio.playbackRate = playbackSpeed;
    audio.volume = isMuted ? 0 : volume;
    audio.play().catch((err) => {
      console.warn('Auto-play prevented or stream loading:', err);
    });
  }, [currentCall, playbackSpeed, volume, isMuted]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !audioSrc) return;

    if (audio.paused) {
      audio.play().then(() => {
        showHotkeyToast('▶ Playing');
      }).catch(console.error);
    } else {
      audio.pause();
      showHotkeyToast('⏸ Paused');
    }
  }, [audioSrc, showHotkeyToast]);

  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (audio && !audio.paused) {
      audio.pause();
    }
  }, []);

  const resume = useCallback(() => {
    const audio = audioRef.current;
    if (audio && audio.paused && audioSrc) {
      audio.play().catch(console.error);
    }
  }, [audioSrc]);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const clamped = Math.max(0, Math.min(seconds, duration || audio.duration || 0));
    audio.currentTime = clamped;
    setCurrentTime(clamped);
  }, [duration]);

  const skip = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const target = audio.currentTime + seconds;
    const maxDur = duration || audio.duration || 9999;
    const clamped = Math.max(0, Math.min(target, maxDur));
    audio.currentTime = clamped;
    setCurrentTime(clamped);
    showHotkeyToast(seconds > 0 ? `⏩ +${seconds}s` : `⏪ ${seconds}s`);
  }, [duration, showHotkeyToast]);

  const setSpeed = useCallback((speed: PlaybackSpeed) => {
    setPlaybackSpeed(speed);
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
    showHotkeyToast(`⚡ Speed ${speed}x`);
  }, [showHotkeyToast]);

  const cycleSpeed = useCallback((direction: 'next' | 'prev' = 'next') => {
    const currentIdx = SPEED_OPTIONS.indexOf(playbackSpeed);
    let nextIdx: number;
    if (direction === 'next') {
      nextIdx = (currentIdx + 1) % SPEED_OPTIONS.length;
    } else {
      nextIdx = (currentIdx - 1 + SPEED_OPTIONS.length) % SPEED_OPTIONS.length;
    }
    const nextSpeed = SPEED_OPTIONS[nextIdx];
    setSpeed(nextSpeed);
  }, [playbackSpeed, setSpeed]);

  const setVolume = useCallback((vol: number) => {
    const clamped = Math.max(0, Math.min(1, vol));
    setVolumeState(clamped);
    setIsMuted(clamped === 0);
    if (audioRef.current) {
      audioRef.current.volume = clamped;
    }
  }, []);

  const toggleMute = useCallback(() => {
    if (isMuted) {
      setIsMuted(false);
      if (audioRef.current) audioRef.current.volume = volume || 1;
      showHotkeyToast('🔊 Unmuted');
    } else {
      setIsMuted(true);
      if (audioRef.current) audioRef.current.volume = 0;
      showHotkeyToast('🔇 Muted');
    }
  }, [isMuted, volume, showHotkeyToast]);

  const closePlayer = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    setIsPlaying(false);
    setIsPlayerVisible(false);
    setCurrentCall(null);
    setAudioSrc(null);
  }, []);

  // Global Keyboard Shortcuts (Hotkeys)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore when user is actively typing in input, textarea, select, contenteditable
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName ? target.tagName.toUpperCase() : '';
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          target.isContentEditable ||
          target.getAttribute('role') === 'textbox'
        ) {
          return;
        }
      }

      // Hotkey: Spacebar (Play/Pause)
      if (e.code === 'Space') {
        if (currentCall && audioSrc) {
          e.preventDefault();
          togglePlay();
        }
      }
      // Hotkey: J / Left Arrow (Skip backward 10s)
      else if (e.code === 'KeyJ' || e.code === 'ArrowLeft') {
        if (currentCall && audioSrc) {
          e.preventDefault();
          skip(-10);
        }
      }
      // Hotkey: L / Right Arrow (Skip forward 10s)
      else if (e.code === 'KeyL' || e.code === 'ArrowRight') {
        if (currentCall && audioSrc) {
          e.preventDefault();
          skip(10);
        }
      }
      // Hotkey: Left Bracket [ (Decrease speed)
      else if (e.code === 'BracketLeft') {
        if (currentCall && audioSrc) {
          e.preventDefault();
          cycleSpeed('prev');
        }
      }
      // Hotkey: Right Bracket ] (Increase speed)
      else if (e.code === 'BracketRight') {
        if (currentCall && audioSrc) {
          e.preventDefault();
          cycleSpeed('next');
        }
      }
      // Hotkey: M (Toggle Mute)
      else if (e.code === 'KeyM') {
        if (currentCall && audioSrc) {
          e.preventDefault();
          toggleMute();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [currentCall, audioSrc, togglePlay, skip, cycleSpeed, toggleMute]);

  return (
    <AudioPlayerContext.Provider
      value={{
        currentCall,
        audioSrc,
        isPlaying,
        isLoading,
        currentTime,
        duration,
        playbackSpeed,
        volume,
        isMuted,
        isPlayerVisible,
        hotkeyNotification,
        playCall,
        togglePlay,
        pause,
        resume,
        seek,
        skip,
        setSpeed,
        cycleSpeed,
        setVolume,
        toggleMute,
        closePlayer,
        setIsPlayerVisible,
      }}
    >
      {children}
    </AudioPlayerContext.Provider>
  );
}

export function useAudioPlayer() {
  const context = useContext(AudioPlayerContext);
  if (!context) {
    throw new Error('useAudioPlayer must be used within an AudioPlayerProvider');
  }
  return context;
}
