# Contributing

Contributions should remain aligned with the public Repeatable Dates API and the project's browser-only boundary.

1. Create a focused branch.
2. Add or update tests for behavioral changes.
3. Run `npm test -- --watch=false --browsers=ChromeHeadless`.
4. Run `npm run build` and `npm audit`.
5. Open a pull request describing the user-facing effect.

Use synthetic dates in examples and tests. Do not submit private schedules, customer information, or infrastructure details.
