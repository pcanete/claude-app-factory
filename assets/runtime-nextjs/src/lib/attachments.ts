import type { PoolClient } from "pg";
import { sql, transactionSql } from "@/lib/db";
import type { AttachmentPolicy, EntitySpec } from "@/lib/spec";

const DEFAULT_ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

export type ResolvedAttachmentPolicy = {
  maxFiles: number;
  maxSizeBytes: number;
  allowedTypes: string[];
};

export type AttachmentMetadata = {
  id: string;
  entity_key: string;
  record_id: string;
  original_name: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  created_by: string | null;
  created_by_name: string | null;
  created_at: Date;
};

type AttachmentContent = AttachmentMetadata & { content: Buffer };

export function resolveAttachmentPolicy(entity: EntitySpec): ResolvedAttachmentPolicy | null {
  const policy: AttachmentPolicy | undefined = entity.attachments;
  if (!policy?.enabled) return null;
  return {
    maxFiles: policy.max_files ?? 20,
    maxSizeBytes: (policy.max_size_mb ?? 3) * 1024 * 1024,
    allowedTypes: policy.allowed_types?.length ? policy.allowed_types : DEFAULT_ALLOWED_TYPES,
  };
}

export function contentTypeAllowed(contentType: string, allowedTypes: string[]) {
  const normalized = contentType.toLowerCase();
  return allowedTypes.some((candidate) => {
    if (candidate.endsWith("/*")) return normalized.startsWith(candidate.slice(0, -1));
    return normalized === candidate;
  });
}

export async function listAttachments(entityKey: string, recordId: string) {
  return sql<AttachmentMetadata>(
    `SELECT attachment.id,
            attachment.entity_key,
            attachment.record_id,
            attachment.original_name,
            attachment.content_type,
            attachment.size_bytes,
            attachment.sha256,
            attachment.created_by,
            creator.display_name AS created_by_name,
            attachment.created_at
       FROM app_attachment AS attachment
       LEFT JOIN app_user AS creator ON creator.id = attachment.created_by
      WHERE attachment.entity_key = $1 AND attachment.record_id = $2
      ORDER BY attachment.created_at DESC`,
    [entityKey, recordId],
  );
}

export async function getAttachmentContent(id: string) {
  const rows = await sql<AttachmentContent>(
    `SELECT attachment.id,
            attachment.entity_key,
            attachment.record_id,
            attachment.original_name,
            attachment.content_type,
            attachment.size_bytes,
            attachment.sha256,
            attachment.created_by,
            creator.display_name AS created_by_name,
            attachment.created_at,
            attachment.content
       FROM app_attachment AS attachment
       LEFT JOIN app_user AS creator ON creator.id = attachment.created_by
      WHERE attachment.id = $1
      LIMIT 1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function lockAttachmentSet(client: PoolClient, entityKey: string, recordId: string) {
  await transactionSql(
    client,
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`${entityKey}:${recordId}`],
  );
}

export async function countAttachments(client: PoolClient, entityKey: string, recordId: string) {
  const rows = await transactionSql<{ count: string }>(
    client,
    "SELECT COUNT(*)::text AS count FROM app_attachment WHERE entity_key = $1 AND record_id = $2",
    [entityKey, recordId],
  );
  return Number(rows[0]?.count ?? 0);
}

export async function insertAttachment(
  client: PoolClient,
  input: {
    entityKey: string;
    recordId: string;
    originalName: string;
    contentType: string;
    content: Buffer;
    sha256: string;
    actorId: string;
  },
) {
  const rows = await transactionSql<{ id: string }>(
    client,
    `INSERT INTO app_attachment
      (entity_key, record_id, original_name, content_type, size_bytes, sha256, content, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      input.entityKey,
      input.recordId,
      input.originalName,
      input.contentType,
      input.content.length,
      input.sha256,
      input.content,
      input.actorId,
    ],
  );
  return rows[0].id;
}

export async function deleteAttachment(
  client: PoolClient,
  entityKey: string,
  recordId: string,
  attachmentId: string,
) {
  const rows = await transactionSql<AttachmentMetadata>(
    client,
    `DELETE FROM app_attachment
      WHERE id = $1 AND entity_key = $2 AND record_id = $3
      RETURNING id, entity_key, record_id, original_name, content_type, size_bytes, sha256,
                created_by, NULL::text AS created_by_name, created_at`,
    [attachmentId, entityKey, recordId],
  );
  return rows[0] ?? null;
}

export async function deleteAttachmentsForRecord(client: PoolClient, entityKey: string, recordId: string) {
  const rows = await transactionSql<{ id: string; original_name: string; size_bytes: number }>(
    client,
    `DELETE FROM app_attachment
      WHERE entity_key = $1 AND record_id = $2
      RETURNING id, original_name, size_bytes`,
    [entityKey, recordId],
  );
  return rows;
}
