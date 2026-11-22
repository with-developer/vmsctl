import { api } from "../lib/api";
import { useState } from "react";
import { useProfile } from "../lib/profile";
import { useAsync, useNow } from "../lib/hooks";
import { useI18n } from "../lib/i18n";
import { ago, ctitle, percent } from "../lib/format";
import { Await, Donut, Empty, Gauge, PageHeader, ScorePill, Severity, StatusBadge, StatusBar, Stat } from "../components/ui";
import { IconAlert, IconClock, IconServer } from "../components/icons";
import { TrendChart } from "../components/charts";
import { GettingStarted } from "../components/start";
import type { FailingControl, HostSummary, Overview, ProfileUse, RegressedControl } from "../lib/types";

export const STALE_DAYS = 7;

/** How many controls the "fix first" list shows, and how many of them the pass-rate sentence adds up. */
const FIX_FIRST = 5;
const TOP = 3;

export function OverviewPage() {
  const { t } = useI18n();
  const state = useAsync(() => api.overview(STALE_DAYS), []);
  const hosts = useAsync(() => api.hosts({ sort: "score", limit: 60, staleDays: STALE_DAYS }), []);
  // The hosts that went silent most recently, wherever their score puts them in the tiles.
  const silent = useAsync(() => api.hosts({ status: "stale", sort: "recent", limit: 2, staleDays: STALE_DAYS }), []);
  return (
    <>
      <PageHeader title={t("overview.title")} subtitle={t("overview.subtitle")} />
      <Await state={state}>
        {(o) =>
          o.hosts === 0 ? (
            <>
              {o.hostsOther ? <p className="muted small">{t("profile.other", { n: o.hostsOther })}</p> : null}
              {o.hostsOther ? <Empty>{t("overview.empty")}</Empty> : <GettingStarted />}
              <Standards />
            </>
          ) : (
            <div className="stack">
              {o.hostsOther ? <p className="muted small">{t("profile.other", { n: o.hostsOther })}</p> : null}
              <section className="hero card">
                <Gauge score={o.score} label={t("overview.score")} />
                <div className="hero-body">
                  <h2>{t("overview.distribution")}</h2>
                  <StatusBar counts={o.counts} legend />
                  <p className="muted small">{t("overview.scoreHelp")}</p>
                  <TopThree o={o} />
                </div>
                <Donut counts={o.counts} label={t("overview.results")} />
              </section>

              <div className="two">
                <FixFirst o={o} />
                <Changes o={o} silent={silent.data?.hosts ?? []} />
              </div>

              <Standards />

              <TrendCard />

              <section className="grid3">
                <Stat icon={<IconServer />} value={o.hosts} label={t("overview.hosts")} />
                <Stat icon={<IconAlert />} value={o.hostsFailing} label={t("overview.failing")} tone={o.hostsFailing > 0 ? "bad" : "good"} help={t("overview.failRate", { n: o.hostsFailing, total: o.hosts })} />
                <Stat icon={<IconClock />} value={o.hostsStale} label={t("overview.stale", o.staleAfterDays)} tone={o.hostsStale > 0 ? "warn" : "good"} />
              </section>

              {(hosts.data?.hosts.length ?? 0) > 0 && <HostTiles hosts={hosts.data?.hosts ?? []} />}
            </div>
          )
        }
      </Await>
    </>
  );
}

/** The pass rate the fleet would have if the first controls of the list were fixed on every host that fails them. */
function TopThree({ o }: { o: Overview }) {
  const { t } = useI18n();
  const gains = o.topFailing.slice(0, TOP).map((c) => c.gain ?? 0);
  if (o.score === null || gains.length < TOP || gains.some((g) => g <= 0)) return null;
  const after = Math.min(1, o.score + gains.reduce((a, b) => a + b, 0) / 100);
  if (percent(after) === percent(o.score)) return null; // a lift too small to show
  return <p className="topthree">{t("overview.topThree", { score: percent(after) })}</p>;
}

/** The failing controls in the order to fix them: severity times the hosts that fail, with what each adds to the pass rate. */
function FixFirst({ o }: { o: Overview }) {
  const { t, lang } = useI18n();
  const list = o.topFailing.slice(0, FIX_FIRST);
  return (
    <section className="card">
      <h2>{t("overview.fixFirst")}</h2>
      <p className="muted small">{t("overview.fixFirstHelp")}</p>
      {list.length === 0 ? (
        <Empty>{t("overview.none")}</Empty>
      ) : (
        <ol className="fixlist">
          {list.map((c: FailingControl) => (
            <li key={`${c.profile}/${c.id}`}>
              <div className="fixlist-main">
                <div className="fixlist-title">
                  <span className="mono id">{c.id}</span> {ctitle(c, lang)}
                </div>
                <div className="muted small">
                  <Severity value={c.severity} /> · {t("overview.onHosts", c.hosts)}
                </div>
              </div>
              {(c.gain ?? 0) > 0 && <span className="gain">{t("overview.gain", { n: points(c.gain ?? 0) })}</span>}
              <a className="button compact" href={`#/controls/${c.profile}/${c.id}`}>
                {t("overview.howToFix")}
              </a>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Percentage points for display: one decimal, or two for a small gain so that it does not read as zero. */
function points(g: number): string {
  return g >= 0.1 ? g.toFixed(1) : g >= 0.01 ? g.toFixed(2) : "<0.01";
}

type Change = { key: string; kind: "regressed" | "fixed" | "stale"; at: string; hostId: number; host: string; what: string; status?: RegressedControl["status"] };

/** What changed lately, newest first: controls that got worse or were fixed, and hosts that stopped reporting. */
function Changes({ o, silent: stale }: { o: Overview; silent: HostSummary[] }) {
  const { t, lang } = useI18n();
  const now = useNow();
  const control = (kind: "regressed" | "fixed") => (r: RegressedControl): Change => ({
    key: `${kind}/${r.hostId}/${r.profile}/${r.id}`, kind, at: r.receivedAt, hostId: r.hostId, host: r.host, what: `${r.id} ${ctitle(r, lang)}`,
    status: kind === "regressed" && r.status === "ERROR" ? r.status : undefined, // worse because the check could not run, not because it failed
  });
  const silent = stale.map((h): Change => ({
      key: `stale/${h.id}`, kind: "stale", at: h.lastScanAt, hostId: h.id, host: h.name,
      what: t("change.staleWhat", Math.max(1, Math.floor((now - Date.parse(h.lastScanAt)) / 86400000))),
    }));
  // A share for each kind, so that a burst of regressions does not hide the fixes and the silent hosts.
  const newest = (a: Change, b: Change) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0);
  const all = [
    ...o.recentRegressions.map(control("regressed")).sort(newest).slice(0, 5),
    ...(o.recentFixes ?? []).map(control("fixed")).sort(newest).slice(0, 3),
    ...silent.sort(newest).slice(0, 2),
  ].sort(newest);
  return (
    <section className="card">
      <h2>{t("overview.changes")}</h2>
      <p className="muted small">{t("overview.changesHelp")}</p>
      {all.length === 0 ? (
        <Empty>{t("overview.none")}</Empty>
      ) : (
        <ul className="changes">
          {all.map((c) => (
            <li key={c.key}>
              <span className={`kind kind-${c.kind}`}>{t(`change.${c.kind}`)}</span>
              <span className="changes-what">
                <a href={`#/hosts/${c.hostId}`}>{c.host}</a> · {c.what} {c.status && <StatusBadge status={c.status} />}
              </span>
              {/* a silent host says how long already */}
              <span className="muted small">{c.kind === "stale" ? "" : ago(c.at, now, t)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Every host as a tile with its pass rate, worst first: a fleet at a glance. */
function HostTiles({ hosts }: { hosts: HostSummary[] }) {
  const { t } = useI18n();
  const now = useNow();
  return (
    <section className="card">
      <div className="titlebar">
        <h2>{t("overview.tiles")}</h2>
        <a href="#/hosts">{t("overview.viewAll")}</a>
      </div>
      <ul className="tiles">
        {hosts.map((h) => (
          <li key={h.id}>
            <a className="tile" href={`#/hosts/${h.id}`}>
              <span className="tile-name">{h.name}</span>
              <ScorePill score={h.score} />
              <span className="muted small">{h.stale ? t("stale") : ago(h.lastScanAt, now, t)}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Every standard the hosts are scanned with, as a card with its pass rate; choosing one shows its numbers on every page. */
function Standards() {
  const { t, lang } = useI18n();
  const { selected, select } = useProfile();
  // Asked again with the overview, so that the card of the shown standard agrees with the numbers above it.
  const fresh = useAsync(() => api.profiles(), []);
  const used = (fresh.data?.profiles ?? []).filter((p): p is ProfileUse & { fleet: NonNullable<ProfileUse["fleet"]> } => !!p.fleet && p.fleet.hosts > 0);
  if (used.length < 2) return null; // one standard: the page above is all about it
  return (
    <section className="card">
      <h2>{t("overview.standards")}</h2>
      <p className="muted small">{t("overview.standardsHelp")}</p>
      <ul className="standards">
        {used.map((p) => {
          const shown = p.id === selected;
          const partial = !!p.standardControls && !!p.controls && p.controls < p.standardControls;
          return (
            <li key={p.id}>
              <button className={`standard${shown ? " on" : ""}`} aria-pressed={shown} onClick={() => select(p.id)}>
                <span className="standard-head">
                  <span className="mono">{p.id}</span>
                  {shown && <span className="tag tag-shown">{t("standard.shown")}</span>}
                </span>
                <span className="standard-title small">{(lang === "ko" && p.titleKo) || p.title || p.id}</span>
                <span className="standard-score">
                  <ScorePill score={p.fleet.score} />
                  <span className="muted small">{t("standard.failing", { failing: p.fleet.failing, hosts: p.fleet.hosts })}</span>
                </span>
                <StatusBar counts={p.fleet.counts} />
                <span className="muted small">
                  {p.standardControls ? t("standard.coverage", { n: p.controls ?? 0, total: p.standardControls }) : t("standard.controls", { n: p.controls ?? 0 })}
                  {partial && <span className="tag tag-partial">{t("standard.partial")}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The fleet's pass rate over the last days (7, 30 or 90), one point a day. */
function TrendCard() {
  const { t } = useI18n();
  const [days, setDays] = useState(30);
  const state = useAsync(() => api.trend(days), [days]);
  // The chart starts where the fleet does: days before the first scan have nothing to show.
  const all = state.data?.points ?? [];
  const first = all.findIndex((p) => p.score !== null);
  const points = first < 0 ? [] : all.slice(first);
  const any = points.length >= 2; // one day is a dot, not a trend
  return (
    <section className="card">
      <div className="titlebar">
        <div>
          <h2>{t("overview.trend")}</h2>
          <p className="muted small">{t("overview.trendHelp")}</p>
        </div>
        <div className="segmented" role="group" aria-label={t("overview.trend")}>
          {[7, 30, 90].map((d) => (
            <button key={d} className={days === d ? "on" : ""} aria-pressed={days === d} onClick={() => setDays(d)}>
              {t("trend.days", { n: d })}
            </button>
          ))}
        </div>
      </div>
      {state.error ? (
        <p className="error-text">{state.error.message}</p>
      ) : !state.data ? (
        <p className="muted">{t("loading")}</p>
      ) : !any ? (
        <Empty>{t("trend.none")}</Empty>
      ) : (
        <TrendChart
          label={t("overview.trend")}
          points={points.map((p) => ({ at: p.at, score: p.score, detail: p.hosts === 0 ? "" : t("trend.detail", { hosts: p.hosts, failing: p.failing }) }))}
        />
      )}
    </section>
  );
}
