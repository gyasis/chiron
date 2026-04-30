# Production Outage 2026-04-15: Payment Gateway 5xx Surge

## TL;DR

On 2026-04-15 between 14:07 and 17:12 UTC, Service A (the public-facing
payment API) returned HTTP 5xx for an estimated 38% of checkout traffic,
causing roughly 21,400 failed transactions and an estimated 184,000 USD
in deferred or abandoned revenue. The proximate cause was an
overly-aggressive circuit-breaker threshold change that interacted with
a small upstream latency drift in Provider P's tokenization endpoint.
The breaker tripped, opened, and stayed open for the duration despite
upstream traffic being healthy.

## Timeline (UTC)

- **14:07** Engineer E1 merges PR #4318 to Service A, lowering the
  circuit-breaker error threshold from 50 errors/sec to 5 errors/sec.
  Stated rationale in the PR description: "tighter breaker, fewer
  cascading failures." PR was approved by a single reviewer with no
  load-test evidence attached.
- **14:11** Deploy pipeline rolls the change to all 12 production pods.
  Canary stage was skipped because the change was tagged `config-only`
  and the deploy template auto-promotes config-only changes.
- **14:34** Provider P's P99 latency drifts from 220 ms to 410 ms during
  a routine internal database failover on their side. Their P50 stays
  flat at 95 ms. No alarm fires on Service A because Service A's
  monitoring threshold for upstream latency is set to P50 only.
- **14:41** Service A's circuit breaker on the tokenization client
  starts seeing intermittent timeouts (8s deadline, 410 ms P99 means a
  long tail of 2s+ requests). At 5 errors/sec it tips into the OPEN
  state within 90 seconds.
- **14:43** All tokenization calls now short-circuit. Service A returns
  HTTP 503 to the checkout frontend for any path that touches
  tokenization (~38% of traffic — guest checkout uses a different
  path).
- **14:48** Customer support sees a spike in chat tickets ("payment not
  going through"). Support escalates to on-call.
- **14:51** PagerDuty alert finally fires — but it is the
  `Checkout-Conversion-Drop` business alert, not a 5xx alert. The 5xx
  rate dashboard panel had been silently broken for 9 days because a
  Prometheus relabel rule dropped the `service_name` label after a
  recent observability migration.
- **15:02** Engineer E2 (on-call) joins the bridge. First hypothesis:
  Provider P is down. E2 opens a ticket with Provider P.
- **15:18** Provider P responds: "Our P50 is normal, P99 is slightly
  elevated, but well under our SLA. We are not seeing failures on our
  side." Hypothesis discarded.
- **15:24** Engineer E3 (subject expert on Service A) joins. Notices
  via raw pod logs that the breaker is OPEN. Asks for the most recent
  deploys.
- **15:37** Team identifies PR #4318 as the only recent change. Begin
  rollback.
- **15:48** Rollback complete on first pod. Breaker resets, traffic
  starts flowing. Pod returns to healthy.
- **16:14** Rollback complete on all 12 pods. 5xx rate begins
  decreasing.
- **17:12** Error budget fully recovered. Breaker stable across all
  pods. Incident declared resolved.

## Detection

The incident was first noticed by **customer support** at 14:48, seven
minutes after the failure mode propagated. The internal observability
stack failed to fire a primary alert because:

1. The 5xx rate panel was broken (label-drop misconfiguration from a
   prior migration; never noticed because no incident had stressed it
   in the 9-day window).
2. The upstream latency alert was bound to P50, which never moved.
3. The business-conversion alert (`Checkout-Conversion-Drop`) fired
   eventually but at a 4-minute evaluation window, so it lagged the
   real failure by ~10 minutes.

## Impact

- 21,400 failed checkout attempts during the 3h 5m window.
- ~184,000 USD in deferred/abandoned revenue (estimate from
  conversion-funnel analysis, recovery rate not yet measured).
- 412 customer support tickets explicitly tied to the incident
  (counted by tag `INC-2026-0415`).
- No data loss. No PII exposure. No corrupted transactions.
- One reputational bruise: Service A's status page showed "all systems
  operational" for the first 27 minutes of the incident because the
  status-page check used the same broken 5xx panel.

## Root Cause

The proximate cause was the change in PR #4318: lowering the
circuit-breaker error threshold from 50 errors/sec to 5 errors/sec
without correspondingly raising the breaker's error-window or adjusting
the request-timeout that feeds it.

The 8-second tokenization deadline was already aggressive for a
provider whose P99 occasionally drifts to 400-500 ms. Under normal load
(~1,200 RPS on the tokenization path), even a small P99 drift produces
a few timeouts per second. The previous threshold of 50/sec absorbed
that. The new threshold of 5/sec did not.

The deeper cause was process: the change was deployed as `config-only`,
which bypassed canary, and was reviewed without load-test evidence. The
PR template did not require either, and the reviewer (a peer in a
different sub-team) lacked context about the upstream P99 sensitivity.

## Why It Wasn't Caught Earlier

Three independent monitoring gaps lined up:

1. **Broken 5xx panel.** The Prometheus label-drop bug had existed for
   9 days. Nothing routine surfaced it because the system had been
   operating inside its error budget. The dashboard rendered "0
   errors" and people trusted it.
2. **Single-percentile upstream alerting.** Provider P's behavior
   degraded only in the tail. P50-bound alerts cannot see tail
   degradation. The circuit-breaker config implicitly assumed a
   tail-aware alert existed; it did not.
3. **No canary on config-only changes.** A canary would have caught
   the breaker trip on a single pod within ~3 minutes, before
   propagation. The deploy template's `config-only` shortcut was
   added 14 months ago for low-risk feature flags and silently
   accumulated breaker-config changes over time.

## Remediation Steps

In the moment:

- Rolled back PR #4318 across all 12 pods (restored 50/sec threshold).
- Manually reset the circuit breaker on each pod after rollback.
- Posted incident status to the public status page once the broken 5xx
  panel was identified as the reason the page lied.
- Opened a ticket with Provider P to investigate the P99 drift; they
  confirmed it was a routine internal failover and would not recur in
  the same form.

Structural follow-ups:

- Fix the Prometheus label-drop bug; backfill alerts on 5xx by raw
  pod label.
- Add a P99-bound upstream-latency alert for every provider Service A
  depends on.
- Remove the `config-only` deploy shortcut. All Service A changes —
  config or code — will canary on 1 of 12 pods for 5 minutes minimum.
- Add a load-test-required gate on PRs that touch
  `circuit_breaker.*` config keys.
- Add the 5xx panel to a synthetic check that verifies it actually
  shows non-zero values when synthetic errors are injected weekly.

## Lessons Learned

- **A "config-only" change is not a low-risk change** when the config
  governs a safety mechanism (breaker, retry, deadline, rate-limit).
- **P50 alerts cannot detect tail-driven failures.** Every external
  dependency needs a P99 (or higher) latency alert tied to actual
  product-impact thresholds, not to provider SLA.
- **A green dashboard is not evidence of health.** Dashboards
  themselves need health checks — a panel that "always shows zero" is
  worse than no panel.
- **Trust in tooling decays silently.** The 5xx panel had been broken
  for 9 days. No one looked at it in detail because no incident
  forced them to.
- **Single-reviewer approval on safety configs is a known
  anti-pattern,** and we re-discovered it the hard way.

## Action Items

| ID | Owner | Description | Due |
|---|---|---|---|
| AI-1 | E2 | Fix Prometheus label-drop on Service A 5xx metrics; verify with synthetic injection | 2026-04-22 |
| AI-2 | E1 | Remove `config-only` deploy shortcut from Service A pipeline; require canary | 2026-04-29 |
| AI-3 | E3 | Add P99-bound upstream-latency alerts for all 4 providers Service A depends on | 2026-05-06 |
| AI-4 | E2 | Add CODEOWNERS rule requiring breaker/retry/deadline config changes to be reviewed by a Service A maintainer + load-test artifact | 2026-05-13 |
| AI-5 | E3 | Author a runbook for circuit-breaker tuning that documents the relationship between threshold, window, and upstream P99 | 2026-05-20 |
| AI-6 | E1 | Synthetic weekly check that verifies the 5xx dashboard panel responds to injected errors | 2026-05-27 |
