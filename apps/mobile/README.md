# Larabee crew app (Android and iPhone)

The app opens the crew clock at https://app.larabeehomesllc.com/clock — same
sign-in, same screens. What it adds is location every two minutes while a man
is clocked in, even with the phone locked in his pocket. A notification saying
"On the clock" stays up while that is happening, and goes away at clock-out.

## Getting the app file

**The easy way:** send the crew this link. On an Android phone it downloads
the app; after that, the steps under "What a crew member taps" below.

https://app.larabeehomesllc.com/downloads/larabee.apk

Every new build replaces that file, so the link always gives the newest app.

**The long way**, if that link ever does not work:

1. Open https://github.com/obxnyc/MHInvestorTemplate/actions/workflows/android.yml
2. Click the top run in the list (the newest one with a green tick).
3. Scroll to the bottom of that page, to **Artifacts**, and click
   **larabee-android**. A zip file downloads.
4. Open the zip. Inside is **app-debug.apk** — that is the app.
5. Send that file to the crew by text or email.

If the list is empty, or you want a fresh copy, press **Run workflow** on that
same page, then **Run workflow** again in the box that opens. It takes about
five minutes.

## What a crew member taps

1. Open the file from the text or email.
2. The phone says it is not allowed to install apps from this source. Tap
   **Settings**, turn on **Allow from this source**, then go back and tap
   **Install**.
3. If a box says "Blocked by Play Protect" or "Unsafe app", tap **More details**
   then **Install anyway**.
4. Open **Larabee**. When asked about **notifications**, tap **Allow** —
   that is the "On the clock" notice that shows while his location is being
   recorded.
5. Sign in with his name and PIN as usual.
6. When asked about **location** (the first time he clocks in), choose
   **Allow all the time** if it is offered. If it is not, choose **While
   using the app** — never **Only this time** and never **Don't allow**.

An update installs over the old app — every build is signed with the same
key. If one ever says "App not installed", uninstall the old Larabee app, then
install the new file.

## iPhone

The same app, sent to the crew through **TestFlight** -- Apple's app for
installing an app before it is in the App Store. A crew member installs
TestFlight from the App Store once, then taps the Larabee link.

GitHub builds it on every change (`.github/workflows/ios.yml`) and once a
month, because a TestFlight build stops opening after 90 days. Until the four
secrets below exist, each run only proves the app compiles and says at the top
"Not sent to TestFlight".

### Once, after Apple approves the developer account (Hudson Yards LLC)

1. **Register the app's id.** https://developer.apple.com/account/resources/identifiers/add/bundleId
   -- choose **App IDs**, **Continue**, **App**, **Continue**. Description
   `Larabee`, **Explicit**, Bundle ID `com.larabeehomes.clock`. Tick nothing
   under Capabilities. **Continue**, **Register**.
2. **Make the app in App Store Connect.** https://appstoreconnect.apple.com/apps
   -- the blue **+**, **New App**. Tick **iOS**. Name `Larabee Crew Clock`
   (it has to be unused across the whole App Store; add a word if it is
   taken). Language English (U.S.). Bundle ID: pick `com.larabeehomes.clock`.
   SKU `larabee-clock`. **Full Access**. **Create**.
3. **A key for GitHub.** https://appstoreconnect.apple.com/access/integrations/api
   -- **Team Keys**, the **+** (or **Generate API Key**). Name `GitHub`,
   Access **Admin**, **Generate**. Then **Download** -- it only lets you once.
   Keep the page open: it shows the **Key ID** beside the key and the
   **Issuer ID** above the list.
4. **The Team ID.** https://developer.apple.com/account -- scroll to
   **Membership details**; Team ID is ten letters and numbers.
5. **Give GitHub the four.** https://github.com/obxnyc/MHInvestorTemplate/settings/secrets/actions
   -- **New repository secret** four times:
   `APPLE_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, and `ASC_KEY_P8` -- for that
   last one open the downloaded `AuthKey_....p8` file in TextEdit and copy
   all of it, including the BEGIN and END lines. Never paste these into chat.
6. **Build it.** https://github.com/obxnyc/MHInvestorTemplate/actions/workflows/ios.yml
   -- **Run workflow**, **Run workflow**. About fifteen minutes; the run's
   summary says "Sent to TestFlight: build N".
7. **Open it to the crew.** In App Store Connect, the app, **TestFlight**,
   the **+** beside **External Testing**, a group called `Crew`. Add the
   build, fill in **Test Information** (Apple's reviewer needs a crew sign-in
   to try it), **Submit for Review** -- about a day the first time, automatic
   after. Then **Enable Public Link** on the group. That link is what the
   crew get.

### What a crew member taps (iPhone)

1. Install **TestFlight** from the App Store.
2. Open the Larabee link on the phone, then **Accept** and **Install**.
3. Open **Larabee**, sign in with his name and PIN.
4. On his first clock-in it asks about **location**: **Allow While Using App**.
   Later the iPhone asks once whether to keep allowing it in the background:
   **Change to Always Allow**. A blue pill in the corner of the screen while
   he is on the clock is the app recording -- it goes at clock-out.
5. When asked about the **camera**, **Allow** -- it is only used when the
   phone cannot find him.
