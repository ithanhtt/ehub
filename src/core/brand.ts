/**
 * The product's name, wherever people see it: tab titles, the header, the
 * web manifest, the auth library.
 *
 * Internal identifiers keep the old name, AdsHub, on purpose — the
 * `adshub_prefs` cookie and `adshub.*` preference keys, the `--adshub-*` CSS
 * variables, the `X-AdsHub-*` update headers and bundle format, `/opt/adshub`
 * on the server. Renaming those would drop everyone's saved choices and stop
 * servers already installed from accepting updates.
 */
export const APP_NAME = 'EHub'
