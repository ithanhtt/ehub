/**
 * The connector plugin contract.
 *
 * Everything the rest of the app knows about TikTok Ads, Sapo, Meta or Shopee
 * arrives through this interface. The core never imports a provider module
 * directly: it reads the registry, renders whatever `auth.fields` and
 * `endpoints` declare, and calls `buildRequest`. That is what makes a new
 * provider a self-contained folder rather than a change spread across the app.
 *
 * A plugin is data first and code second — the endpoint catalogue is a plain
 * array, so the API Hub can list, search and form-generate against a provider
 * whose transport code has not been written yet.
 */

import type { HttpResult } from './http'

export type LocalizedText = { vi: string; en: string }

export type PluginCategory = 'ads' | 'ecommerce' | 'analytics' | 'crm' | 'other'

/* ------------------------------------------------------------------ auth --- */

export type AuthFieldType = 'text' | 'password' | 'select' | 'number' | 'url'

export interface AuthField {
  key: string
  label: LocalizedText
  type: AuthFieldType
  /** Encrypted at rest and never returned to the browser in clear text. */
  secret?: boolean
  required?: boolean
  placeholder?: string
  help?: LocalizedText
  options?: Array<{ value: string; label: string }>
  /**
   * Consumed when the connection is saved and never stored.
   *
   * For single-use values such as an OAuth `auth_code`: `resolveCredentials`
   * trades it for something durable, and keeping the spent code afterwards
   * would only be a stale secret that looks like a working one.
   */
  transient?: boolean
}

export interface OAuthSpec {
  authorizeUrl: string
  tokenUrl: string
  scopes: string[]
  /** Provider-specific extras appended to the authorize URL. */
  extraAuthorizeParams?: Record<string, string>
}

export interface AuthSpec {
  type: 'api_key' | 'oauth2' | 'basic' | 'custom'
  /** Fields rendered on the "add connection" form, in order. */
  fields: AuthField[]
  oauth?: OAuthSpec
  /** Shown above the form: where to obtain these values. */
  instructions?: LocalizedText
  /**
   * A step-by-step walk-through shown in the connection dialog, for a
   * provider whose setup happens mostly elsewhere (a cloud console, sharing a
   * file) and cannot fit in `instructions`. Plain data, like the rest of the
   * contract: the dialog renders whatever a connector declares.
   */
  guide?: ConnectionGuide
}

/* ----------------------------------------------------------------- guide --- */

/**
 * Text of a guide may mark **bold** and `code`; nothing else is interpreted,
 * so a guide can never inject markup.
 */
export interface ConnectionGuide {
  /** The ways to connect, as tabs when there are several; the first opens first. */
  methods: GuideMethod[]
  /** Reference tables after the steps — what a file must look like, say. */
  references?: GuideReference[]
  /** What the provider says, what it means, and what to do. */
  troubleshooting?: Array<{ problem: LocalizedText; fix: LocalizedText }>
}

export interface GuideMethod {
  id: string
  label: LocalizedText
  /** A short tag beside the label ("recommended"). */
  badge?: LocalizedText
  /** One line on when to choose it. */
  summary?: LocalizedText
  steps: GuideStep[]
}

export interface GuideStep {
  title: LocalizedText
  /** The step's lines, in order. */
  lines: LocalizedText[]
  links?: Array<{ href: string; label: LocalizedText }>
  /** Said in a warning tone, after the lines. */
  caution?: LocalizedText
  /**
   * A value to copy at this step, shown with a copy button: read live from a
   * form field as the user fills it (a key inside pasted JSON), or else from
   * the saved connection's metadata.
   */
  copy?: { label: LocalizedText; field?: { key: string; jsonKey?: string }; metadataKey?: string; pending: LocalizedText }
}

export interface GuideReference {
  title: LocalizedText
  columns: LocalizedText[]
  rows: LocalizedText[][]
  note?: LocalizedText
}

/* -------------------------------------------------------------- endpoints --- */

export type ParamType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'enum'
  | 'json'
  | 'string[]'

export interface ParamSpec {
  key: string
  label: LocalizedText
  in: 'query' | 'body' | 'path' | 'header'
  type: ParamType
  required?: boolean
  defaultValue?: unknown
  options?: Array<{ value: string; label: string }>
  help?: LocalizedText
  placeholder?: string
  /**
   * The provider requires this value, but the connector can supply it from the
   * connection when the user leaves it blank (a saved advertiser id, the app
   * credentials).
   *
   * The browser cannot see credentials, so it must not block submission on
   * such a field — it skips the required check and lets the server, which does
   * hold the connection, be the real gate after `resolveParams` has run.
   */
  satisfiedByConnection?: boolean
  /**
   * Offer choices from the selected connection's metadata instead of a bare
   * text box: `list` names a `{ id, name }[]` the connector stored (the
   * advertisers a TikTok token can reach), `auto` the value it fills in when
   * the field is left blank.
   *
   * Without it, "auto" is a promise the form cannot explain: a blank
   * advertiser silently meant the connection's default account, and a report
   * on an account with no matching campaigns came back empty with no hint why.
   */
  choicesFrom?: { list: string; auto?: string }
}

export type PaginationStyle = 'none' | 'page' | 'cursor' | 'offset'

export interface PaginationSpec {
  style: PaginationStyle
  pageParam?: string
  sizeParam?: string
  cursorParam?: string
  /** Dotted path to the next cursor / total-pages value in the response. */
  nextCursorPath?: string
  totalPagesPath?: string
  defaultPageSize?: number
  maxPageSize?: number
}

export interface EndpointSpec {
  /** Stable within a plugin; used in URLs, logs and saved requests. */
  id: string
  /** Grouping label in the API Hub sidebar, e.g. "Campaign" or "Order". */
  group: string
  name: LocalizedText
  description?: LocalizedText
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  params: ParamSpec[]
  docsUrl?: string
  /** Dotted path to the array of records, e.g. "data.list". */
  resultPath?: string
  /** Field on each record that identifies it, used to upsert on re-sync. */
  idField?: string
  pagination?: PaginationSpec
  /**
   * Marks an endpoint that changes remote state. The Hub requires an extra
   * confirmation before firing one so a curious click cannot pause a campaign.
   */
  mutating?: boolean
  /**
   * The path is known; its parameters and response shape are not.
   *
   * Providers publish an index of endpoint paths but no machine-readable spec
   * (probed: TikTok and Sapo both), so a catalogue can be broad or it can be
   * confirmed, not both at once. Rather than pick, an entry declares which one
   * it is. Consumers hold the unconfirmed ones to a lower bar: the Hub labels
   * them and will not persist a dataset from one, since the field that
   * identifies a record has not been established and an index-based key
   * silently re-orders on the next sync.
   */
  unverified?: boolean
  /** Response shape shown before the first call is made. */
  sampleResponse?: unknown
}

/* --------------------------------------------------------------- runtime --- */

export interface ConnectionContext {
  /** Decrypted credential bag, keyed by AuthField.key. */
  credentials: Record<string, string>
  /** Non-secret connector state persisted alongside the connection. */
  metadata: Record<string, unknown>
  connectionId: string
  projectId: string
}

export interface PreparedRequest {
  url: string
  method: string
  headers: Record<string, string>
  /** Already-serialised body; the executor does not re-encode it. */
  body?: string
  /** Kept for logging so a failed call can be reproduced by hand. */
  redactedUrl?: string
}

export interface TestResult {
  ok: boolean
  /** Raw, precise text — usually the provider's own message. Not translated. */
  message: string
  /**
   * i18n key under `connections.hints.*` naming *what the user should do*.
   *
   * A provider code like "40105" is precise but not actionable, and it is the
   * same string in every language. The hint carries the diagnosis — which
   * field is actually at fault and what to check — so the UI can show it in
   * the user's language next to the provider's exact wording.
   */
  hint?: string
  /** Merged into connections.metadata on success (advertiser id, shop name…). */
  metadata?: Record<string, unknown>
}

export interface BuildRequestArgs {
  endpoint: EndpointSpec
  params: Record<string, unknown>
  context: ConnectionContext
}

/* ---------------------------------------------------- credential resolve --- */

export interface CredentialResolution {
  /** false stops the save and shows `message` / `hint` as a form error. */
  ok: boolean
  /** What to encrypt and store. Transient inputs must not appear here. */
  credentials: Record<string, string>
  /** Raw note, usually from the provider. Not translated. */
  message?: string
  /** i18n key under `connections.hints.*`. */
  hint?: string
  metadata?: Record<string, unknown>
}

/* --------------------------------------------------------------- actions --- */

export type FindingState = 'ok' | 'fail' | 'warn' | 'unknown' | 'skipped'

/** One line of a diagnostic checklist, already translated by the connector. */
export interface ActionFinding {
  label: LocalizedText
  state: FindingState
  /** Raw supporting text — a provider message, a discovered id. Not translated. */
  detail?: string
}

export interface ConnectorActionResult {
  ok: boolean
  /** Raw summary, usually from the provider. Not translated. */
  message: string
  /** i18n key under `connections.hints.*`, as on TestResult. */
  hint?: string
  findings?: ActionFinding[]
  /**
   * Credentials to merge into the connection and re-encrypt — how an action
   * such as an auth-code exchange hands back a freshly minted token.
   */
  credentialUpdates?: Record<string, string>
  metadata?: Record<string, unknown>
}

/**
 * A connector-declared repair or inspection tool, offered on the connection.
 *
 * Credential problems are provider-specific and the provider is the only thing
 * that can answer them — "are these app credentials real?" has no generic
 * form. Declaring such operations on the plugin keeps that knowledge in the
 * connector folder: the settings screen renders whatever actions it finds and
 * knows nothing about TikTok's OAuth quirks.
 */
export interface ConnectorAction {
  id: string
  label: LocalizedText
  description?: LocalizedText
  /** Extra values the user supplies to run it; rendered like auth fields. */
  inputs?: AuthField[]
  /**
   * True when the action can rewrite stored credentials.
   *
   * Read-only actions are available to anyone who can view the connection;
   * mutating ones require the same permission as editing it by hand.
   */
  mutatesCredentials?: boolean
  run(args: {
    context: ConnectionContext
    input: Record<string, string>
  }): Promise<ConnectorActionResult>
}

export interface ConnectorPlugin {
  id: string
  name: string
  description: LocalizedText
  version: string
  category: PluginCategory
  /** Brand colour used for the plugin chip; any valid CSS colour. */
  color: string
  docsUrl?: string
  auth: AuthSpec
  endpoints: EndpointSpec[]
  /**
   * Every `TestResult.hint` key this connector can return.
   *
   * Declared rather than inferred so `npm run check:plugins` can prove each
   * one has a translation. An untranslated hint would surface as a blank
   * diagnosis at exactly the moment the user needs it most.
   */
  hints?: readonly string[]

  /**
   * Repair and inspection tools shown on the connection, in order.
   *
   * Optional: a connector whose credentials cannot go subtly wrong needs none.
   */
  actions?: ConnectorAction[]

  /**
   * Last chance to turn what the user typed into what should be stored.
   *
   * Runs once, on save, before the credentials are encrypted. It exists so a
   * provider whose durable credential must be *fetched* can do that in the
   * same step the user submits the form — pasting an OAuth `auth_code` and
   * pasting a ready access token become the same single action, instead of
   * saving first and hunting for a separate tool afterwards.
   *
   * Returning `ok: false` rejects the save with the message and hint shown on
   * the form, which is how "you gave me neither of the two things I accept"
   * gets reported.
   */
  resolveCredentials?(args: {
    /** Submitted values merged over what was already stored. */
    credentials: Record<string, string>
    /** What was stored before this save; empty on create. */
    previous: Record<string, string>
  }): Promise<CredentialResolution>

  /**
   * Renews a credential that expires on its own — an OAuth access token with a
   * refresh token beside it — before a call is made with it.
   *
   * Returns null when nothing is due (the common case, and it must be cheap:
   * it runs ahead of every use). Otherwise the renewed credentials are merged
   * into the stored bag and re-encrypted by core/plugins/fresh-credentials,
   * the one place outside a save or an action that writes credentials; `ok:
   * false` leaves them as they are and the call goes ahead to fail visibly.
   */
  refreshCredentials?(context: ConnectionContext): Promise<CredentialResolution | null>

  /**
   * Fills in params the connection can supply, before validation runs.
   *
   * Kept separate from `buildRequest` so that a value sourced from the
   * connection is validated exactly like a typed-in one — doing it inside
   * `buildRequest` would place it after the gate it needs to pass.
   */
  resolveParams?(args: BuildRequestArgs): Record<string, unknown>

  /**
   * Where a relative path resolves to for this connection.
   *
   * Required, because it is the boundary that makes ad-hoc requests safe: a
   * user-supplied path is resolved against this and then checked to still be
   * inside it. Sapo hosts every tenant on its own domain, so this takes the
   * context rather than being a constant.
   */
  resolveBaseUrl(context: ConnectionContext): string

  /** Turns an endpoint plus user params into a concrete HTTP request. */
  buildRequest(args: BuildRequestArgs): PreparedRequest

  /**
   * Takes over one call that a single request cannot answer — a listing that
   * has to be gathered across every advertiser a token reaches, say. Returns
   * null to leave the call to `buildRequest` as usual.
   *
   * `prepared` is what the Hub's Request tab shows; for a gathered answer it
   * is the first of the requests made.
   */
  runEndpoint?(args: BuildRequestArgs): Promise<{ result: HttpResult; prepared: PreparedRequest } | null>

  /**
   * Headers for a request the catalogue does not describe.
   *
   * Defaults to whatever  would send, but a connector that
   * signs per-endpoint can override it.
   */
  customHeaders?(context: ConnectionContext): Record<string, string>

  /**
   * Finishes a request the catalogue does not describe, once its URL, headers
   * and body are known — for a provider that signs every request over exactly
   * those (TikTok Shop), or needs a token fetched first (a Google service
   * account). The URL may gain query parameters but must stay on the same
   * host and path: it has already been checked to lie inside the base URL.
   */
  prepareCustomRequest?(request: PreparedRequest, context: ConnectionContext): Promise<PreparedRequest>

  /**
   * Cheap credential check. Implementations should call the lightest
   * authenticated endpoint the provider offers, never a reporting call.
   */
  testConnection(context: ConnectionContext): Promise<TestResult>

  /**
   * Providers that return HTTP 200 with an error code in the body (TikTok Ads
   * does) implement this to surface the real failure.
   */
  parseError?(status: number, body: unknown): string | null
}
