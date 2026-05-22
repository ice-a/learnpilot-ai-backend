# Review

## Checks
- Backend build passed.
- Password-forgot flow now catches email send failures and logs warning instead of bubbling 500.

## Scope
- Only changed reset-email sending path in AuthService.
