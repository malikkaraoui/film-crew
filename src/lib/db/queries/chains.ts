import { db } from '../connection'
import { chain, publicationAccount } from '../schema'
import { eq } from 'drizzle-orm'

export async function getChains() {
  return db.select().from(chain).orderBy(chain.createdAt)
}

export async function getChainById(id: string) {
  const rows = await db.select().from(chain).where(eq(chain.id, id))
  return rows[0] ?? null
}

export async function createChain(data: {
  id: string
  name: string
  langSource: string
  audience?: string
}) {
  const [row] = await db.insert(chain).values(data).returning()
  return row
}

export async function updateChain(id: string, data: Partial<{
  name: string
  langSource: string
  audience: string
  brandKitPath: string
}>) {
  const [row] = await db
    .update(chain)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(chain.id, id))
    .returning()
  return row
}

export async function deleteChain(id: string) {
  await db.delete(chain).where(eq(chain.id, id))
}

// Publication accounts

export async function getPublicationAccounts(chainId: string) {
  return db.select().from(publicationAccount).where(eq(publicationAccount.chainId, chainId))
}

export async function createPublicationAccount(data: {
  id: string
  chainId: string
  platform: string
  credentials?: unknown
}) {
  const [row] = await db.insert(publicationAccount).values(data).returning()
  return row
}

export async function deletePublicationAccount(id: string) {
  await db.delete(publicationAccount).where(eq(publicationAccount.id, id))
}
