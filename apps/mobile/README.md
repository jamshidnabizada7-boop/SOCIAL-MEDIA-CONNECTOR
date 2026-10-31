# All-in-One Social — Android MVP

This is a **new Flutter Android client** for the existing Aria Hub Social Media Connector backend.
It does not replace or redeploy the current Next.js website, API, worker, or database.

## Already implemented

- Existing-account sign-in and account registration through the real Fastify API.
- Restore session from Android secure storage (no plaintext password storage).
- Workspace selection for users belonging to multiple workspaces.
- Read actual connected accounts, their providers, handles, and connection health.
- Read the existing Unified Social Inbox (comments/notifications) from API data.
- Pull-to-refresh, explicit error/empty/loading states, and sign-out.
- No simulated social actions, scraped social feeds, or demo fallback.

## Not included in this MVP

Universal reels feed, Stories, DMs, cross-provider search, Like/Comment action buttons,
new network connections, and publishing. These require separately reviewed provider
permissions and their own implementation. Inbox is **read-only** in this version.

## Local Android setup

Install Flutter stable and Android SDK. In this directory:

```bash
flutter create --platforms=android --project-name aria_social_mobile --org com.myariahub .
flutter pub get
flutter analyze
flutter test
flutter run --dart-define=API_BASE_URL=https://app.myariahub.com
```

`flutter create` generates the standard Android Gradle/Kotlin scaffolding while
preserving the checked-in source and Internet permission manifest. Generated
platform build files are intentionally not part of this MVP until the toolchain
has generated and validated them.

For APK:

```bash
flutter build apk --debug --dart-define=API_BASE_URL=https://app.myariahub.com
```

The debug APK is generated at `build/app/outputs/flutter-apk/app-debug.apk`.
A GitHub Actions workflow also compiles and uploads this APK as a workflow
artifact for this feature branch and pull request.

**Security:** Only use HTTPS API URLs. The app stores the opaque `aria_session`
cookie in Android Keystore-backed secure storage, never the email password or
provider tokens. No secrets or provider app credentials are compiled into the APK.
The existing cookie session and OAuth callback flow remain web-first. A future
native OAuth/deep-link integration requires its own security review.

**Deployment:** GitHub branch changes do not appear at `app.myariahub.com` automatically.
The Android app must be installed separately. The production web app is untouched.
