import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.js'

const DEFAULT_LOCAL = 'postgresql://postgres:postgres@127.0.0.1:55322/postgres'

/**
 * Single Postgres connection pool + Drizzle instance. `DATABASE_URL` points at
 * Supabase (local Docker in dev, hosted in prod). Server-side service connection
 * — the client never talks to Postgres directly; the API enforces tenancy in code.
 */
export const connectionString = process.env.DATABASE_URL ?? DEFAULT_LOCAL

export const sql = postgres(connectionString, { max: 10 })
export const db = drizzle(sql, { schema })
export type DbClient = typeof db
