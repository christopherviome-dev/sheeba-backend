# Sheeba backend tests

Run them all with:

    npm test

It must end with `TOTAL: … passed, 0 failed`. Run it before every push to `main`.

- Tests use stand-in data (no real database), so they are safe to run anywhere and never touch live data.
- `legacy-*.test.js` were written 25–27 Sep and restored on 28 Sep. Where Sheeba's rules have since
  changed on purpose (friendly member codes, international phone numbers, checked coupon-style
  invite rewards, hidden phone numbers for shop helpers, admin rights checked live), the tests were
  updated to the current rules. None of those updates hid a bug.
- The other files cover the work from 27–28 Sep: login security, reports and restrictions, messages,
  training, apprentice work, the engineering review, profiles, Fresh Look, Look Reel, field work,
  the shop team and chair card, admin roles, admin analytics, sign-up and sources.
- When you add or change a feature, add or update its test here, in the same push.
