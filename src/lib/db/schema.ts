import { pgTable, text, integer, real, timestamp, jsonb } from 'drizzle-orm/pg-core'

export const chain = pgTable('chain', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  langSource: text('lang_source').notNull().default('fr'),
  audience: text('audience'),
  brandKitPath: text('brand_kit_path'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

export const publicationAccount = pgTable('publication_account', {
  id: text('id').primaryKey(),
  chainId: text('chain_id').notNull().references(() => chain.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(), // 'tiktok' | 'youtube' | 'instagram' | 'facebook' | 'x'
  credentials: jsonb('credentials'), // tokens, identifiants (server-side only)
  isActive: integer('is_active').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow(),
})

export const run = pgTable('run', {
  id: text('id').primaryKey(),
  chainId: text('chain_id').references(() => chain.id),
  type: text('type').notNull().default('standard'), // 'standard' | 'viral'
  idea: text('idea').notNull(),
  template: text('template'),
  status: text('status').notNull().default('pending'), // pending | running | paused | completed | failed | killed
  currentStep: integer('current_step').default(1),
  costEur: real('cost_eur').default(0),
  lastHeartbeat: timestamp('last_heartbeat'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

export const runStep = pgTable('run_step', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => run.id, { onDelete: 'cascade' }),
  stepNumber: integer('step_number').notNull(),
  stepName: text('step_name').notNull(),
  status: text('status').notNull().default('pending'),
  providerUsed: text('provider_used'),
  costEur: real('cost_eur').default(0),
  inputData: jsonb('input_data'),
  outputData: jsonb('output_data'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  error: text('error'),
})

export const clip = pgTable('clip', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => run.id, { onDelete: 'cascade' }),
  stepIndex: integer('step_index').notNull(),
  prompt: text('prompt').notNull(),
  provider: text('provider').notNull(),
  status: text('status').notNull().default('pending'),
  filePath: text('file_path'),
  seed: integer('seed'),
  costEur: real('cost_eur').default(0),
  retries: integer('retries').default(0),
  createdAt: timestamp('created_at').defaultNow(),
})

export const agentTrace = pgTable('agent_trace', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => run.id, { onDelete: 'cascade' }),
  agentName: text('agent_name').notNull(),
  messageType: text('message_type').notNull(), // prompt | response | validation | web_search
  content: jsonb('content').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
})

export const providerLog = pgTable('provider_log', {
  id: text('id').primaryKey(),
  runId: text('run_id').references(() => run.id),
  provider: text('provider').notNull(),
  endpoint: text('endpoint'),
  requestData: jsonb('request_data'),
  responseStatus: integer('response_status'),
  responseData: jsonb('response_data'),
  latencyMs: integer('latency_ms'),
  costEur: real('cost_eur').default(0),
  createdAt: timestamp('created_at').defaultNow(),
})

export const config = pgTable('config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

export const audioAsset = pgTable('audio_asset', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => run.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),       // AudioAssetType: dialogue_script | sound_bible | music_intentions | audio_timeline | audio_preview | audio_final
  data: jsonb('data'),                // contenu JSON de l'artefact
  filePath: text('file_path'),        // chemin fichier WAV si applicable
  durationS: real('duration_s'),
  status: text('status').notNull().default('draft'), // AudioAssetStatus: draft | assembled | validated | rejected
  validatedAt: timestamp('validated_at'),
  validatedBy: text('validated_by'),  // 'human' | 'auto'
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})
