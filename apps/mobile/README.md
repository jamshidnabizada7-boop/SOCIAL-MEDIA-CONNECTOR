# All-in-One Social Android — functional MVP (0.2.0)

This Android Flutter app now loads the **real, already-deployed web application**
(`https://app.myariahub.com/feed`) in a persistent WebView. This is a deliberate
bridge to reuse **working, server-owned features**, not to simulate a universal
consumer social feed or reinvent the backend.

## Features exposed from the existing production web app

- Home Feed and provider-attributed content
- Explore / search of **collected authorized sources**, with source limits
- Video feed with available **official provider players**
- Unified Inbox for the **supported interactions**
- Connected accounts and provider connections
- Post composer and publishing/scheduling on approved networks
- Creator Studio, posts, calendar, publishing queue

Use the Android top-right **menu** to jump between sections.
Use **Open in Chrome** for provider OAuth connections that block embedded
browsers, file/video behaviors not working inside the WebView, or external
browser compatibility. External social links are handed to the default
browser/social app. The in-app browser stores its own site session, so signing
in to the system browser alone may not sign in to the in-app WebView.

The Android media chooser is connected to HTML file inputs via Android WebView
and the native system file picker. Provider-side publishing still depends on
valid account authorization, formats, app permissions and quotas.

## Important capability limits

- The app **does not** expose arbitrary Instagram/Facebook/TikTok following
  feeds or original algorithmic For You feeds through private APIs.
- Telegram and WhatsApp DMs, arbitrary contact lists, cross-network DMs,
  unsupported native likes/comments/follows and truly global searches
  are **not implemented** in the existing backend.
- Feed results are from permitted sources only; the provider's official
  webpage may be opened when the app cannot play/show a post in-place.
- No fake posts, simulated provider operations or credential scraping.
- The root web app is already deployed independently. These Android commits
  **do not deploy or modify** the live Oracle backend or database.

## Build and verification

The source can be built on GitHub Actions. Download the APK artifact named
`all-in-one-social-android-debug-apk` from a green
`Flutter Android MVP` run on this branch. **Do not use the old build**.

To build locally, with Flutter stable and Android SDK:

```bash
cd apps/mobile
flutter create --platforms=android --project-name aria_social_mobile --org com.myariahub .
flutter pub get
flutter analyze
flutter test
flutter build apk --debug
```

The output is `build/app/outputs/flutter-apk/app-debug.apk`.
Install this only for testing; a properly signed **release** requires a separate
signing and distribution setup. Real-device checks (login, OAuth, uploads,
video playback, working permissions) are required before a production release.
