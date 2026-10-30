# Gym Manager (PWA) - GitHub + Netlify + Firebase

Works on phone and laptop, syncs live between them, installs like an app. No build step: Netlify serves these files as-is.

## Step 1 - Create the Firebase project (free Spark plan)
1. Go to https://console.firebase.google.com > **Add project** (name it e.g. `my-gym`; Google Analytics can be off).
2. **Build > Authentication > Get started > Sign-in method**
   - Enable **Email/Password**.
   - On the same provider, also turn on **Email link (passwordless sign-in)** (used by "Login with OTP link").
3. **Build > Firestore Database > Create database** > choose a nearby region (e.g. `asia-south1` Mumbai) > start in **production mode**.

## Step 2 - Connect the app to Firebase
1. Project settings (gear icon) > **Your apps** > click the **Web `</>`** icon > register the app (skip hosting).
2. Copy the `firebaseConfig` values and paste them into **`firebase-config.js`**.

## Step 3 - Security rules (important)
Firestore Database > **Rules** tab > replace everything with the contents of **`firestore.rules`** > **Publish**.
This makes every gym's data readable only by its own logged-in owner (and by the trainers the owner invites - see "Trainers" below).

## Step 4 - Upload to GitHub
1. Create a new repository on github.com (private is fine).
2. Click **Add file > Upload files** and drag in **everything inside this folder** (index.html, sw.js, manifest.webmanifest, netlify.toml, firebase-config.js, firestore.rules, README.md and the `js`, `css`, `icons`, `fonts`, `vendor` folders). Commit.
   Keep the folder structure: `index.html` must be at the top level of the repo.

## Step 5 - Deploy on Netlify
1. https://app.netlify.com > **Add new site > Import an existing project > GitHub** > pick the repo.
2. Build command: leave empty. Publish directory: `.` (already set by `netlify.toml`). Click **Deploy**.
3. You get a live link like `https://something.netlify.app` (you can rename it in Site settings).

## Step 6 - Allow your live link in Firebase
Authentication > **Settings > Authorized domains > Add domain** > add your Netlify domain (`something.netlify.app`). Without this, login emails/links will fail.

## Step 7 - Create your account & install the app
1. Create the owner login: Firebase > Authentication > **Users > Add user** (email + password). Then open the live link and log in with it. (A first-time setup form is also available at `your-link/?setup`.)
2. In **Settings**: set your plans/prices, edit the WhatsApp message, upload your logo.
3. **Install**
   - Android (Chrome): menu ⋮ > **Add to Home screen / Install app**.
   - iPhone (Safari): Share > **Add to Home Screen**.
   - Laptop (Chrome/Edge): install icon at the right end of the address bar.

## How things work
- **Due date** = start date + plan days (30 / 90 / 180 / 365, editable). Renewing an active member starts the new period at the old due date; an expired member starts on the renewal date. The renewal screen shows start, due date and days left before you save.
- **Edit renewal**: member profile > *Edit renewal date / plan*. Due date, status, reminders, dashboard and invoices update automatically; edits are logged. Only the member's current (latest) renewal can be edited.
- **Dashboard dues**: *Renewal dues* = members ending in the next 5 days + expired 2 days ago or less (amount = current plan price). *Unpaid balance* = money still owed on joined/renewed plans. Tap either card for the member list with Renew / WhatsApp / Call / Collect.
- **Changing a joining or renewal start date** also moves that renewal's payment and invoice date, so monthly revenue and new-joinings counts land in the right month.
- **Reminders** has two tabs (Expiring soon / Already expired). Expired members get their own WhatsApp message, editable in Settings.
- **Welcome message**: after adding a member you can send a welcome on WhatsApp; it stays available on the Reminders > Welcome tab for the first day. WhatsApp then sends nothing while more than 5 days remain, a renewal reminder at 5 days or less, the expired message for 2 days after expiry, and nothing after that.
- **Photos** are compressed (about 20-30 KB) and stored inside the database, so you do not need the paid Firebase Storage.
- **Backups**: saved automatically once a day when you open the app (last 7 kept) + "Download all data" (JSON + 3 CSV files) + restore from file or cloud.
- **Login with mobile number** works by looking up the email registered with that number. **Forgot password** emails a reset link to the registered email.

## Honest limits (and how to upgrade later)
- **SMS OTP** (to a mobile number) is not included: Firebase phone/SMS verification needs a paid (Blaze) plan and SMS costs. This app uses email links instead. Mobile numbers are not OTP-verified.
- **Fingerprint unlock**: not built in; use the 4-digit PIN here (or your phone's own app lock).
- WhatsApp opens a pre-filled chat; you tap Send yourself (WhatsApp does not allow silent auto-sending). On phone, "Send on WhatsApp" for invoices shares the PDF directly; on laptop it downloads the PDF and opens the chat so you can attach it.
- Updating the app: edit files on GitHub; Netlify redeploys. If you do not see a change, close and reopen the app once (cached copy refreshes in the background).

## Branding, invoice terms
- Logo files are in `icons/` (`logo.png` wide logo, `logo-emblem.png`, and the app icons). Replace them with new images of the same names to change the branding.
- **Terms & Conditions and Gym Rules** are edited in **Settings → Invoice terms & gym rules**. They print on an extra page of every invoice (PDF, print and WhatsApp). Leave both boxes empty to print the invoice without that page.

## Brand lettering
The gym name is shown in logo-style lettering (first word light blue, the rest yellow) using the bundled Exo 2 font (SIL Open Font License) in /fonts.

## Trainers (limited logins)
The owner can invite trainers. Each trainer gets their own login on their own phone.
**What a trainer can do:** add members; edit a member only for 10 minutes after adding that member; renew memberships; collect payments; see the member list and pending dues (names and amounts owed).
**What a trainer cannot do:** see phone numbers, revenue, reports, billed/paid totals; send WhatsApp messages or call from the app; change settings, plans or backups; edit, delete or export old members. Health details are hidden unless the owner switches them on for that trainer.
Every member shows **Added by**, every renewal shows **Renewed by** and every payment shows **Collected by**. **Trainers > Recent trainer activity** lists what each trainer did.

### One-time setup (owner)
1. Firebase > Authentication > Sign-in method: keep **Email/Password** ON (trainers create their own login with it). Do not turn sign-ups off.
2. Publish the new **`firestore.rules`** (Firestore > Rules > paste > Publish). The rules are what really stop a trainer from doing things the screens hide.
3. **Recommended lock:** Authentication > Users > copy your own **User UID**. In `firestore.rules`, find `isOwner` and use the commented line, pasting your UID. This stops anyone else who creates an account from getting their own gym space in your database.
4. Log in as the owner > **Trainers** > enter the trainer's name and email > **Invite trainer**.
5. Ask the trainer to open your live link, tap **Create your trainer login**, use the same email and make a password, then tap the verification link in their email and press **I have verified my email**.
6. To stop a trainer: **Trainers > Switch off** (or **Remove**). They lose access immediately.

### Good to know
- Hiding phone numbers and money is done in the app screens. The data of a member is stored in one record, so a technically skilled trainer using browser developer tools could still read it. The rules do block trainers from writing anything they are not allowed to.
- The 10-minute edit time is measured by Firebase's clock, so changing a phone's clock does not extend it.
- A trainer can add new entries (a renewal or a payment) to any member but cannot change or remove old ones.


## Trainer login notes (v11)
- A removed trainer who tries to log in sees a short message on the login screen ("access was removed…"), and a person who was never added sees "not added as a trainer". They are signed out automatically, so reopening the app shows the login screen.
- If you add a removed trainer again, they do NOT sign up again. They log in with their old password (or tap *Forgot Password?*).
- Forgot password: the reset email's "Continue" button brings the person back to this app. For this, your Netlify domain must be listed in Firebase > Authentication > Settings > Authorized domains.
- `firestore.rules` already contains the owner lock for UID `y0neSASkGGUFMvBJTcoG8Jd3GpC2`. Check it matches the owner login in Firebase > Authentication > Users.
