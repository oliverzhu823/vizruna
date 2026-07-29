function notarizeOptions(appPath) {
  if (
    process.env.APPLE_ID &&
    process.env.APPLE_APP_SPECIFIC_PASSWORD &&
    process.env.APPLE_TEAM_ID
  ) {
    return {
      appPath,
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID,
    }
  }
  if (
    process.env.APPLE_API_KEY &&
    process.env.APPLE_API_KEY_ID &&
    process.env.APPLE_API_ISSUER
  ) {
    return {
      appPath,
      appleApiKey: process.env.APPLE_API_KEY,
      appleApiKeyId: process.env.APPLE_API_KEY_ID,
      appleApiIssuer: process.env.APPLE_API_ISSUER,
    }
  }
  if (process.env.APPLE_KEYCHAIN_PROFILE) {
    return {
      appPath,
      keychainProfile: process.env.APPLE_KEYCHAIN_PROFILE,
      ...(process.env.APPLE_KEYCHAIN
        ? { keychain: process.env.APPLE_KEYCHAIN }
        : {}),
    }
  }
  return null
}

module.exports = async function notarizeReleaseArtifacts(context) {
  const required = process.env.PI_RELEASE_REQUIRE_NOTARIZATION === '1'
  const images = (context.artifactPaths || []).filter((path) =>
    path.toLowerCase().endsWith('.dmg'),
  )
  if (images.length === 0) {
    if (required) throw new Error('No DMG artifact was produced for notarization')
    return []
  }
  const options = notarizeOptions(images[0])
  if (!options) {
    if (required) throw new Error('Notarization credentials are missing')
    console.warn('[mac-release] skipping DMG notarization outside release mode')
    return []
  }
  const { notarize } = await import('@electron/notarize')
  const { execFileSync } = await import('node:child_process')
  for (const image of images) {
    console.log(`[mac-release] notarizing disk image ${image}`)
    await notarize({ ...options, appPath: image })
    console.log(`[mac-release] stapling notarization ticket to ${image}`)
    execFileSync('xcrun', ['stapler', 'staple', image], { stdio: 'inherit' })
  }
  return []
}
