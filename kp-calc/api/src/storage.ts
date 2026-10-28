// Хранилище картинок: S3-совместимое (Timeweb), если заданы S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY/S3_SECRET_KEY/S3_REGION,
// иначе таблица image_blobs в PostgreSQL (для теста и небольших объёмов). Ключи — только из окружения сервера.
import type pg from 'pg';

export type StorageKind = 'db' | 's3';

export interface Storage {
  kind: StorageKind;
  put(id: string, data: Buffer, mime: string): Promise<void>;
  /** storage — где лежит именно эта картинка (после смены режима старые картинки читаются по-старому). */
  get(id: string, storage: StorageKind): Promise<Buffer | null>;
}

export interface S3Env {
  S3_ENDPOINT?: string; S3_BUCKET?: string; S3_ACCESS_KEY?: string; S3_SECRET_KEY?: string; S3_REGION?: string; S3_PREFIX?: string;
}

export const s3Configured = (env: S3Env) => !!(env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY && env.S3_SECRET_KEY);

function dbStorage(pool: pg.Pool) {
  return {
    async put(id: string, data: Buffer) {
      await pool.query('insert into image_blobs (image_id, data) values ($1, $2) on conflict (image_id) do update set data = excluded.data', [id, data]);
    },
    async get(id: string): Promise<Buffer | null> {
      const { rows: [r] } = await pool.query('select data from image_blobs where image_id = $1', [id]);
      return r ? r.data : null;
    },
  };
}

function s3Storage(env: S3Env) {
  const prefix = (env.S3_PREFIX ?? 'kp-calc/images/').replace(/^\/+/, '');
  // SDK загружаем только когда S3 включён: без него сервер работает с хранением в базе
  let client: Promise<{ s3: any; mod: any }> | null = null;
  const conn = () => (client ??= import('@aws-sdk/client-s3').then((mod: any) => ({
    mod,
    s3: new mod.S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION || 'ru-1',
      forcePathStyle: true,
      credentials: { accessKeyId: env.S3_ACCESS_KEY as string, secretAccessKey: env.S3_SECRET_KEY as string },
      // S3-совместимые хранилища не всегда понимают новые контрольные суммы SDK
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    }),
  })));
  return {
    async put(id: string, data: Buffer, mime: string) {
      const { s3, mod } = await conn();
      await s3.send(new mod.PutObjectCommand({ Bucket: env.S3_BUCKET, Key: prefix + id, Body: data, ContentType: mime }));
    },
    async get(id: string): Promise<Buffer | null> {
      const { s3, mod } = await conn();
      try {
        const r = await s3.send(new mod.GetObjectCommand({ Bucket: env.S3_BUCKET, Key: prefix + id }));
        return Buffer.from(await r.Body.transformToByteArray());
      } catch (e: any) {
        if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return null;
        throw e;
      }
    },
  };
}

export function createStorage(pool: pg.Pool, env: S3Env = process.env): Storage {
  const db = dbStorage(pool);
  const s3 = s3Configured(env) ? s3Storage(env) : null;
  return {
    kind: s3 ? 's3' : 'db',
    put: (id, data, mime) => (s3 ? s3.put(id, data, mime) : db.put(id, data)),
    get: (id, storage) => (storage === 's3' ? (s3 ? s3.get(id) : Promise.resolve(null)) : db.get(id)),
  };
}

/** Тип картинки по первым байтам: png, jpeg, webp. Остальное не принимаем. */
export function sniffImage(b: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export const MAX_IMAGE = 10 * 1024 * 1024;
