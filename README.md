# Repeatable Dates Playground

An interactive Angular application for exploring the recurrence and business-day policies provided by [Repeatable Dates](https://github.com/clindelof/RepeatableDates).

The playground turns schedule rules into calendar and timeline views, explains adjusted dates, and generates Python that matches the library's public API.

[Open the live playground](https://clindelof.github.io/RepeatableDatesPlayground/)

## Features

- One-time, weekly, monthly, ordinal-weekday, and selected-month rules
- Every-N-week, month, and year intervals
- Optional end dates and occurrence limits
- Clamp or skip behavior for invalid month dates
- Previous, next, and nearest business-day adjustment
- Configurable weekend days and custom holiday calendars
- Keep, deduplicate, and error collision policies
- Explicit included and excluded dates
- Calendar and chronological timeline views
- Stable schedule JSON and generated Python
- Shareable URL configurations plus JSON import and export
- Curated payroll, billing, maintenance, and reporting examples

## Local development

```bash
npm install
npm start
```

Open `http://localhost:4200`.

## Verification

```bash
npm test -- --watch=false --browsers=ChromeHeadless
npm run build
npm audit
```

## Architecture

This is a browser-only Angular application. It has no backend, database, account system, analytics, or external calendar service. Configuration can be stored in the URL or exported as JSON.

The TypeScript recurrence engine mirrors Repeatable Dates 0.3 for visualization. The Python library remains the authoritative implementation for production use.

## Scope

Repeatable Dates models calendar dates, not times of day, time zones, cron expressions, or full iCalendar recurrence rules. The playground follows that boundary.

## License

[MIT](LICENSE)
