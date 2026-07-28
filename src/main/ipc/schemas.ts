import { z } from 'zod'

export const shellOpenPathSchema = z.object({
  path: z.string(),
})

export const shellShowItemSchema = z.object({
  path: z.string(),
})

export const workspaceFsListDirSchema = z.object({
  workspaceRoot: z.string(),
  path: z.string().optional(),
})

export const workspaceFsReadTextSchema = z.object({
  workspaceRoot: z.string(),
  path: z.string(),
  maxBytes: z.number().optional(),
})

export const workspaceFsRenameSchema = z.object({
  workspaceRoot: z.string(),
  relativePath: z.string(),
  newName: z.string(),
})

export const sessionExportSchema = z.object({
  format: z.enum(['json', 'markdown', 'html']).optional(),
  sessionFile: z.string().optional(),
})

export const sessionNavigateTreeSchema = z.object({
  targetId: z.string().min(1),
  sessionFile: z.string().optional(),
  summarize: z.boolean().optional(),
  label: z.string().optional(),
})

export const sessionGetMessagesSchema = z.object({
  sessionFile: z.string(),
  offset: z.number().optional(),
  limit: z.number().optional(),
  /** After navigateTree: force branch tip so history matches rewound leaf */
  leafId: z.string().nullable().optional(),
})

export const sessionNewSchema = z.object({
  workspaceId: z.string().min(1),
  modelId: z.string().min(1).optional(),
  thinkingLevel: z.string().min(1).optional(),
})

export const sessionDeleteSchema = z.object({
  sessionFile: z.string().min(1),
})

export const sessionPrepareSchema = z.object({
  sessionFile: z.string().min(1),
})

export const sessionLeaseInspectSchema = z.object({
  sessionFile: z.string().min(1),
})

export const sessionLeaseTakeoverSchema = z.object({
  sessionFile: z.string().min(1),
  confirmed: z.literal(true),
})

export const workspaceOpenSchema = z.object({
  path: z.string().min(1),
  awaitWorker: z.boolean().optional(),
})

export const worktreeRootSchema = z.object({
  rootWorkspacePath: z.string().min(1).optional(),
})

export const worktreeCreateSchema = z.object({
  rootWorkspacePath: z.string().min(1).optional(),
  name: z.string().trim().max(80).optional(),
  branchName: z.string().trim().min(1).max(200).optional(),
  baseRef: z.string().trim().min(1).max(200).optional(),
  createdBySession: z.string().max(2_000).optional(),
})

export const worktreeIdSchema = z.object({
  id: z.string().uuid(),
})

export const worktreeRemoveSchema = z
  .object({
    id: z.string().uuid(),
    force: z.boolean().optional(),
    confirmed: z.boolean().optional(),
    deleteBranch: z.boolean().optional(),
  })
  .superRefine((request, context) => {
    if (request.force === true && request.confirmed !== true) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'forced removal requires confirmed=true',
        path: ['confirmed'],
      })
    }
  })

export const orchestrationListSchema = z.object({
  rootWorkspacePath: z.string().min(1).optional(),
})

export const orchestrationCreateSchema = z.object({
  parentSessionFile: z.string().min(1),
  rootWorkspacePath: z.string().min(1).optional(),
  goal: z.string().trim().min(1).max(20_000),
  name: z.string().trim().max(120).optional(),
  environment: z.enum(['worktree', 'local']).optional(),
  timeoutMs: z.number().int().min(1_000).max(86_400_000).optional(),
})

export const orchestrationIdSchema = z.object({
  relationshipId: z.string().uuid(),
})

export const orchestrationSendSchema = orchestrationIdSchema.extend({
  text: z.string().trim().min(1).max(20_000),
})

export const orchestrationResumeSchema = orchestrationIdSchema.extend({
  action: z.enum(['continue', 'retry']),
})

export const reliabilityRootSchema = z.object({
  rootWorkspacePath: z.string().min(1).optional(),
})

export const auditQuerySchema = z.object({
  category: z.string().trim().min(1).max(80).optional(),
  action: z.string().trim().min(1).max(160).optional(),
  outcome: z.enum(['success', 'blocked', 'failed']).optional(),
  workspaceId: z.string().min(1).max(4_000).optional(),
  sessionFile: z.string().min(1).max(4_000).optional(),
  from: z.number().int().nonnegative().optional(),
  to: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(10_000).optional(),
})

export const auditExportSchema = z.object({
  query: auditQuerySchema.optional(),
  format: z.enum(['json', 'jsonl']),
})

export const metadataRestoreSchema = z.object({
  backupId: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[A-Za-z0-9._-]+$/),
  confirmation: z.literal('RESTORE_METADATA'),
})

export const proxyProfileSaveSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  protocol: z.enum(['http', 'https', 'socks5', 'socks5h']),
  host: z
    .string()
    .trim()
    .min(1)
    .max(253)
    .refine((value) => !/[/?#@\s]/.test(value), 'host must not contain a URL scheme'),
  port: z.number().int().min(1).max(65_535),
  username: z.string().trim().max(200).optional(),
  noProxy: z
    .string()
    .trim()
    .max(2_048)
    .refine((value) => !/[\r\n\u0000-\u001f\u007f]/.test(value), 'invalid NO_PROXY')
    .optional(),
  password: z.string().max(4_096).optional(),
  preservePassword: z.boolean().optional(),
})

export const proxyProfileDeleteSchema = z.object({
  id: z.string().uuid(),
  confirmed: z.literal(true),
})

export const providerRouteSetSchema = z
  .object({
    provider: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9._:-]+$/),
    mode: z.enum(['direct', 'system', 'profile']),
    profileId: z.string().uuid().optional(),
  })
  .superRefine((value, context) => {
    if (value.mode === 'profile' && !value.profileId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'profileId is required for profile mode',
        path: ['profileId'],
      })
    }
  })

export const providerRoutingDiagnoseSchema = z.object({
  provider: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9._:-]+$/),
})

export const workspaceSandboxDeleteSchema = z.object({
  path: z.string().min(1),
})

export const promptTextSchema = z.object({
  text: z.string(),
  sessionFile: z.string().optional(),
})

const CLIPBOARD_IMAGE_MAX_BYTES = 8 * 1024 * 1024

export const clipboardWriteTempImageSchema = z
  .object({
    data: z.string().min(1),
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp']),
  })
  .superRefine((req, ctx) => {
    const bytes = Buffer.from(req.data, 'base64')
    if (bytes.length > CLIPBOARD_IMAGE_MAX_BYTES) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'image too large', path: ['data'] })
    }
  })

export const piSettingsSetSchema = z.object({
  patch: z.record(z.unknown()),
})

export const shellReadImagePreviewSchema = z.object({
  workspaceRoot: z.string().min(1),
  path: z.string().min(1),
})

export const reviewMutationSchema = z.object({
  cwd: z.string().optional(),
  files: z
    .array(
      z.object({
        path: z.string(),
        hunkPatches: z.array(z.string()),
      }),
    )
    .optional(),
  message: z.string().optional(),
})

export const reviewArtifactReadTextSchema = z.object({
  path: z.string().min(1).max(8_000),
  maxBytes: z.number().int().min(1).max(1024 * 1024).optional(),
})

export const sdkInstallSchema = z.object({
  version: z.string().min(1),
})

const settingsValueSchemas: Record<string, z.ZodTypeAny> = {
  theme: z.enum(['light', 'dark', 'sage', 'system']),
  language: z.enum(['zh', 'en']),
  currentProject: z.string().nullable(),
  recentProjects: z.array(z.string()),
  autoOpenLastProject: z.boolean(),
  autoCheckRegistryUpdates: z.boolean(),
  ignoredUpdateVersion: z.string(),
  alertSoundEnabled: z.boolean(),
  alertNotificationEnabled: z.boolean(),
  alertOnExtensionUi: z.boolean(),
  alertOnRunIdle: z.boolean(),
  alertOnBackgroundRunIdle: z.boolean(),
  maxSessionWorkers: z.number().int().min(1).max(16),
  sessionWorkerIdleTimeoutMinutes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  timelineMaxAutoExpandedTools: z.number().int().min(0).max(50),
  rightPanelPrefs: z.record(z.boolean()),
  rightPanelOrder: z.array(z.string()),
  sessionDisplayNames: z.record(z.string()),
  extensionOverrides: z.record(z.boolean()),
  skillOverrides: z.record(z.boolean()),
  extensionConfigs: z.record(z.record(z.unknown())),
  panelWidths: z
    .object({ sidebar: z.number(), right: z.number() })
    .nullable(),
  windowBounds: z
    .object({ width: z.number(), height: z.number(), x: z.number().optional(), y: z.number().optional() })
    .nullable(),
  asrConfig: z.record(z.unknown()),
}

export const settingsSetSchema = z
  .object({
    key: z.string().min(1),
    value: z.unknown(),
  })
  .superRefine((req, ctx) => {
    const schema = settingsValueSchemas[req.key]
    if (!schema) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'unknown settings key', path: ['key'] })
      return
    }
    const parsed = schema.safeParse(req.value)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({ ...issue, path: ['value', ...issue.path] })
      }
    }
  })
