import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getS3Client } from '@/lib/aws';
import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { connectToDatabase, withDbRetry } from '@/lib/db';
import { CallModel } from '@/lib/models';
import { cacheGet, cacheSet } from '@/lib/cache';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function getUploadsDir() {
  const rootDir = process.cwd();
  if (rootDir.endsWith('apps/web') || rootDir.endsWith('apps\\web')) {
    return path.join(rootDir, 'uploads', 'recordings');
  }
  return path.join(rootDir, 'apps', 'web', 'uploads', 'recordings');
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    let recordingId = params.id;
    let s3KeyTarget: string | null = null;

    // Check fast Redis cache before touching database
    const directCacheKey = `s3:audio:${params.id}`;
    const directCachedUrl = await cacheGet<string>(directCacheKey);
    if (directCachedUrl) {
      return NextResponse.redirect(directCachedUrl, 307);
    }

    // 1. Resolve actual recordingId or s3Key from MongoDB using flexible lookup
    try {
      await connectToDatabase();
      const isHex24 = typeof params.id === 'string' && /^[0-9a-fA-F]{24}$/.test(params.id);
      const query: any = {
        $or: [
          { idempotencyKey: params.id },
          { audioUrl: { $regex: params.id, $options: 'i' } },
          { s3Key: { $regex: params.id, $options: 'i' } },
        ],
      };
      if (isHex24) {
        query.$or.push({ _id: params.id });
      }

      const callDoc = await withDbRetry(async () => {
        return await (CallModel as any).findOne(query).select('s3Key audioUrl agentName counselorName').lean().exec();
      });

      if (callDoc) {
        if (callDoc.s3Key) {
          s3KeyTarget = callDoc.s3Key;
        }
        if (callDoc.audioUrl) {
          const match = callDoc.audioUrl.match(/recordings\/([^\/]+)\/audio/);
          if (match && match[1]) {
            recordingId = match[1];
          }
        }
      }
    } catch (dbErr: any) {
      console.log(`[AudioRoute] DB lookup notice for ${recordingId}:`, dbErr?.message || dbErr);
    }

    // 2. Try fetching from AWS S3 Bucket via direct Presigned GET URL
    const s3Info = getS3Client();
    if (s3Info) {
      try {
        const parts = recordingId.split('_');
        const agentPrefix1 = parts.length >= 2 ? parts.slice(0, 2).join('_') : '';
        const agentPrefix2 = parts.length >= 1 ? parts[0] : '';

        const candidateKeys: string[] = [];
        if (s3KeyTarget) candidateKeys.push(s3KeyTarget);
        if (agentPrefix1) {
          candidateKeys.push(`recordings/${agentPrefix1}/${recordingId}.webm`);
          candidateKeys.push(`recordings/${agentPrefix1}/${recordingId}.mp3`);
          candidateKeys.push(`recordings/${agentPrefix1}/${recordingId}.m4a`);
          candidateKeys.push(`recordings/${agentPrefix1}/${recordingId}.wav`);
          candidateKeys.push(`recordings/${agentPrefix1}/${recordingId}`);
        }
        if (agentPrefix2 && agentPrefix2 !== agentPrefix1) {
          candidateKeys.push(`recordings/${agentPrefix2}/${recordingId}.webm`);
          candidateKeys.push(`recordings/${agentPrefix2}/${recordingId}.mp3`);
          candidateKeys.push(`recordings/${agentPrefix2}/${recordingId}.m4a`);
          candidateKeys.push(`recordings/${agentPrefix2}/${recordingId}.wav`);
          candidateKeys.push(`recordings/${agentPrefix2}/${recordingId}`);
        }
        candidateKeys.push(`recordings/${recordingId}.webm`);
        candidateKeys.push(`recordings/${recordingId}.mp3`);
        candidateKeys.push(`recordings/${recordingId}.m4a`);
        candidateKeys.push(`recordings/${recordingId}.wav`);
        candidateKeys.push(`recordings/${recordingId}.3gp`);
        candidateKeys.push(`recordings/${recordingId}`);
        candidateKeys.push(`${recordingId}.webm`);
        candidateKeys.push(`${recordingId}.mp3`);
        candidateKeys.push(`${recordingId}.m4a`);

        let resolvedS3Key: string | null = null;

        for (const key of candidateKeys) {
          try {
            await s3Info.client.send(new HeadObjectCommand({ Bucket: s3Info.bucket, Key: key }));
            resolvedS3Key = key;
            break;
          } catch {
            // candidate key not in bucket, continue
          }
        }

        // Intelligent prefix fallback: If direct candidate keys missed, search counselor folder by phone digits
        if (!resolvedS3Key && (agentPrefix1 || agentPrefix2)) {
          try {
            const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
            const searchPrefix = `recordings/${agentPrefix1 || agentPrefix2}/`;
            const listRes = await s3Info.client.send(new ListObjectsV2Command({
              Bucket: s3Info.bucket,
              Prefix: searchPrefix,
              MaxKeys: 50
            }));
            const digits = recordingId.replace(/\D/g, '');
            const cleanDigits = digits.length >= 10 ? digits.slice(-10) : '';
            if (cleanDigits && listRes.Contents) {
              const matchedObj = listRes.Contents.find(o => o.Key && o.Key.includes(cleanDigits));
              if (matchedObj?.Key) {
                resolvedS3Key = matchedObj.Key;
              }
            }
          } catch {
            // ignore listing fallback error
          }
        }

        if (resolvedS3Key) {
          const S3_CACHE_KEY = `s3:audio:${resolvedS3Key}`;

          // Check in-memory cache for instant 0ms redirect
          const cachedUrl = await cacheGet<string>(S3_CACHE_KEY);
          if (cachedUrl) {
            return NextResponse.redirect(cachedUrl, 307);
          }

          const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
          const ext = resolvedS3Key.endsWith('.mp3') ? 'mp3' : resolvedS3Key.endsWith('.wav') ? 'wav' : resolvedS3Key.endsWith('.webm') ? 'webm' : 'm4a';
          const mime = ext === 'mp3' ? 'audio/mpeg' : ext === 'wav' ? 'audio/wav' : ext === 'webm' ? 'audio/webm' : 'audio/mp4';
          const downloadFilename = `Recording_${recordingId}.${ext}`;

          const command = new GetObjectCommand({
            Bucket: s3Info.bucket,
            Key: resolvedS3Key,
            ResponseContentType: mime,
            ResponseContentDisposition: `inline; filename="${downloadFilename}"`,
          });
          const presignedUrl = await getSignedUrl(s3Info.client, command, { expiresIn: 3600 });

          // Cache in memory for 55 minutes
          await cacheSet(S3_CACHE_KEY, presignedUrl, 3300);
          await cacheSet(directCacheKey, presignedUrl, 3300);

          return NextResponse.redirect(presignedUrl, 307);
        }
      } catch (s3Err) {
        console.warn(`S3 Presigned lookup error for ${recordingId}:`, s3Err);
      }
    }

    // 3. Try fetching from Local Disk Storage fallback
    const uploadsDir = getUploadsDir();
    const possibleLocalFiles = [
      path.join(uploadsDir, `${recordingId}.mp3`),
      path.join(uploadsDir, `${recordingId}.m4a`),
      path.join(uploadsDir, `${recordingId}.wav`),
      path.join(uploadsDir, `${recordingId}.3gp`),
      path.join(uploadsDir, `${recordingId}`)
    ];

    const createAudioResponse = (buffer: Buffer, mimeType: string = 'audio/mp4') => {
      const rangeHeader = req.headers.get('range');
      const totalSize = buffer.length;

      if (rangeHeader) {
        const parts = rangeHeader.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
        const chunkSize = end - start + 1;
        const chunk = buffer.subarray(start, end + 1);

        return new Response(chunk as any, {
          status: 206,
          headers: {
            'Content-Type': mimeType,
            'Content-Range': `bytes ${start}-${end}/${totalSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkSize.toString(),
            'Cache-Control': 'public, max-age=3600',
          },
        });
      }

      return new Response(buffer as any, {
        status: 200,
        headers: {
          'Content-Type': mimeType,
          'Content-Length': totalSize.toString(),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    };

    for (const filePath of possibleLocalFiles) {
      try {
        const buffer = await fs.readFile(filePath);
        if (buffer.length > 0) {
          const mime = filePath.endsWith('.wav') ? 'audio/wav'
                     : filePath.endsWith('.mp3') ? 'audio/mpeg'
                     : filePath.endsWith('.3gp') ? 'audio/3gpp'
                     : 'audio/mp4';
          return createAudioResponse(buffer, mime);
        }
      } catch {
        // try next local path
      }
    }

    return NextResponse.json({ message: 'Audio recording file not found in S3 or local storage' }, { status: 404 });
  } catch (err: any) {
    return NextResponse.json({ message: err.message || 'Error streaming audio' }, { status: 500 });
  }
}
