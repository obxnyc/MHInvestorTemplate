# Larabee crew app (Android)

The app opens the crew clock at https://app.larabeehomesllc.com/clock — same
sign-in, same screens. What it adds is location every two minutes while a man
is clocked in, even with the phone locked in his pocket. A notification saying
"On the clock" stays up while that is happening, and goes away at clock-out.

## Getting the app file

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

If an update will not install ("App not installed"), uninstall the old Larabee
app first, then install the new file.
