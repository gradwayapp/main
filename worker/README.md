# GradWay Campus Insights server (Cloudflare Worker + D1)

This small server receives GradWay's anonymous campus activity and gives each university its own numbers
on `insights.html`. Cloudflare's free plan is enough to start (100,000 events a day, 5 GB of storage).

## What it stores

One row per event: the date and hour, the campus, the event type (visit, route, search, place, action),
student or visitor, and, for routes, the destination, distance (to 50 m), minutes, walk or drive and a
~150 m grid square. Searches keep their text only when they found nothing. **No IP addresses, accounts,
device IDs or starting points are stored.** The insights answer leaves out any destination, grid square
or search seen fewer than 10 times.

## Set it up (about 15 minutes, once)

1. Make a free Cloudflare account, then on your computer install Node.js and run `npm install -g wrangler`
   and `wrangler login`.
2. In this `worker` folder: `wrangler d1 create gradway-insights`. Copy the `database_id` it prints into
   `wrangler.toml`.
3. Create the table: `wrangler d1 execute gradway-insights --remote --file=schema.sql`
4. Make the keys. One per licensed campus, plus one for you (`*` sees every campus):
   `wrangler secret put KEYS`, then paste for example
   `{"*":"a-long-random-admin-key","Mississippi State University":"another-long-random-key"}`.
   Long random keys: `openssl rand -hex 24`.
5. `wrangler deploy`. It prints the address, like `https://gradway-insights.yourname.workers.dev`.
6. Put that address in the site's `config.js` as `insightsEndpoint`, and publish the site.

## Give a university its dashboard

Send them: `https://gradwayapp.github.io/main/insights.html?campus=mississippi-state-university&key=THEIR-KEY`

The key only opens that campus. Without a key (or before there's data) the page shows sample data,
which is what you show in sales meetings.

## Before turning it on

- Update the Privacy Policy's "Campus insights" section if anything here changes.
- Have a lawyer look at your license agreement: it should say the data is anonymous and aggregated,
  and that small groups are hidden.
