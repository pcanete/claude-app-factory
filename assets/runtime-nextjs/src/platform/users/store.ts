import type { PoolClient } from "pg";
import { sql, transactionSql } from "@/lib/db";

export type ManagedUser = {
  id: string;
  authSubject: string;
  email: string;
  displayName: string;
  roleKey: string;
  roleLabel: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type ManagedUserRow = {
  id: string;
  auth_subject: string;
  email: string;
  display_name: string;
  role_key: string;
  role_label: string;
  active: boolean;
  created_at: Date;
  updated_at: Date;
};

export type ManagedUserInput = {
  email: string;
  displayName: string;
  roleKey: string;
  active: boolean;
};

const USER_SELECT = `SELECT users.id,
                            users.auth_subject,
                            users.email,
                            users.display_name,
                            users.role_key,
                            roles.label AS role_label,
                            users.active,
                            users.created_at,
                            users.updated_at
                       FROM app_user AS users
                       JOIN app_role AS roles ON roles.key = users.role_key`;

function mapUser(row: ManagedUserRow): ManagedUser {
  return {
    id: row.id,
    authSubject: row.auth_subject,
    email: row.email,
    displayName: row.display_name,
    roleKey: row.role_key,
    roleLabel: row.role_label,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function isManagedUserId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function isLocalPreviewIdentity(authSubject: string) {
  return authSubject.startsWith("development:");
}

export function isPendingIdentity(authSubject: string) {
  return authSubject.startsWith("pending:");
}

export async function listManagedUsers(filters: { query?: string; active?: boolean } = {}) {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (filters.query) {
    values.push(`%${filters.query}%`);
    conditions.push(`(users.display_name ILIKE $${values.length} OR users.email ILIKE $${values.length})`);
  }
  if (typeof filters.active === "boolean") {
    values.push(filters.active);
    conditions.push(`users.active = $${values.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = await sql<ManagedUserRow>(
    `${USER_SELECT}
      ${where}
      ORDER BY users.active DESC, users.display_name ASC
      LIMIT 250`,
    values,
  );
  return rows.map(mapUser);
}

export async function getManagedUser(id: string) {
  const rows = await sql<ManagedUserRow>(`${USER_SELECT} WHERE users.id = $1 LIMIT 1`, [id]);
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function getManagedUserForUpdate(client: PoolClient, id: string) {
  const rows = await transactionSql<ManagedUserRow>(client, `${USER_SELECT} WHERE users.id = $1 FOR UPDATE OF users`, [id]);
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function createManagedUser(client: PoolClient, input: ManagedUserInput & { authSubject: string }) {
  const rows = await transactionSql<{ id: string }>(
    client,
    `INSERT INTO app_user (auth_subject, email, display_name, role_key, active)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [input.authSubject, input.email, input.displayName, input.roleKey, input.active],
  );
  return rows[0].id;
}

export async function updateManagedUser(client: PoolClient, id: string, input: ManagedUserInput) {
  await transactionSql(
    client,
    `UPDATE app_user
        SET email = $2,
            display_name = $3,
            role_key = $4,
            active = $5,
            updated_at = now()
      WHERE id = $1`,
    [id, input.email, input.displayName, input.roleKey, input.active],
  );
}
